import type { ProjectSkillTrust } from "./project-skill-trust.js";
import { join } from "node:path";
import type { BashToolSettings } from "@nervekit/contracts/settings";
import { subagentBlockedToolNames } from "@nervekit/contracts/subagents";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { ConfigurationPreviewInput } from "@nervekit/conversation-core";
import type { ToolDefinition } from "@nervekit/tools/catalog";
import type { Skill } from "@nervekit/harness/resources";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { loadHarnessResources } from "./resource-loader.js";
import { buildNerveSystemPrompt } from "./nerve-system-prompt.js";
import { withAgentProfiles } from "./turn-resources.adapter.js";
import { resolveSkillPlaceholders } from "../../builtin-skills/index.js";
import { isToolEnabled } from "../tool-enablement.js";
import { configuredNamespaces } from "@nervekit/tools/extension-host";
import {
  quickScriptDescription,
  type QuickScriptRegistry,
} from "@nervekit/tools/quick-script";
import type { ExtensionResolution } from "@nervekit/contracts/extensions";
import type { AccountsReader } from "../../domains/accounts/accounts.service.js";
import {
  extensionAvailability,
  extensionToolOffered,
} from "../extensions/extension-availability.js";
import { createExtensionPorts } from "../extensions/extension-ports.js";
import type { ExtensionStore } from "../extensions/extension-store/extension-store.js";
import type { ModelHosts } from "../model-hosts.js";

const blocked = new Set<string>(subagentBlockedToolNames);

export function scopedTurnResources(options: {
  home: string;
  service: AgentConfigurationService;
  tools(
    cwd: string,
    id?: string,
    bash?: BashToolSettings,
  ): Promise<ToolDefinition[]>;
  nerveSkills(): readonly Skill[];
  agentBrowserSkills(): readonly Skill[];
  /** Project skills reach the agent only after the user approved them. */
  projectSkillTrust: ProjectSkillTrust;
  hasChildren(id: string): boolean;
  /** The extensions the host serves: one registry, or the registry of the conversation's project. */
  registry:
    | QuickScriptRegistry
    | ((projectDir: string) => Promise<QuickScriptRegistry>);
  /** The model hosts extensions' availability hooks check. */
  models?: ModelHosts;
  /** The durable store behind `ctx.extensionStore` in availability hooks. */
  extensionStore?: ExtensionStore;
  /** Resolved extension settings and the home's accounts, for this conversation. */
  extensions(
    conversationId: string | undefined,
    projectId: string,
  ): Promise<{ resolution: ExtensionResolution; accounts: AccountsReader }>;
}) {
  return async (
    input: ConfigurationPreviewInput,
    settings: LeadSettingsOverrides,
    instructions: string,
    missingReferences: readonly string[] = [],
  ) => {
    const child = input.conversation.parentConversationId !== null;
    const registry =
      typeof options.registry === "function"
        ? await options.registry(input.projectDir)
        : options.registry;
    const { resolution, accounts } = await options.extensions(
      input.conversation.id,
      input.conversation.projectId,
    );
    // Direct tools of extensions are offered while the extension (and its switch) is on and its requirements are met.
    const offered = await extensionAvailability(
      registry,
      resolution,
      accounts,
      {
        checkSecrets: true,
        ports: createExtensionPorts({
          resolution,
          accounts,
          models: options.models,
          store: options.extensionStore,
          projectId: input.conversation.projectId,
        }),
      },
    );
    const selected = [
      ...(await options.tools(
        input.projectDir,
        input.conversation.id,
        settings.tools?.bash?.settings as BashToolSettings,
      )),
      ...input.coreTools,
    ].filter(
      (tool) =>
        !(child && blocked.has(tool.name)) &&
        isToolEnabled(tool.name, settings, missingReferences) &&
        // A tool of an extension that this project's registry lacks (another project's) is not offered.
        (!tool.extension ||
          registry.tools.some(
            (entry) => entry.definition.name === tool.name,
          )) &&
        extensionToolOffered(offered, tool.name),
    );
    const profiles = [];
    if (!child && selected.some((tool) => tool.name === "subagent_prompt"))
      for (const [name, selection] of Object.entries(
        settings.subagents ?? {},
      )) {
        if (selection.enabled === false) continue;
        const profile = await options.service.profiles.get(
          name,
          input.conversation.projectId,
          "child",
        );
        if (profile.status === "available")
          profiles.push({
            name,
            whenToUse: profile.definition.whenToUse,
            permission: "Independent child policy",
          });
      }
    // Only configured namespaces: unavailability stays out of the description so credential changes keep the prompt prefix.
    const quickScriptText = quickScriptDescription(
      {
        namespaces: configuredNamespaces(
          (
            await extensionAvailability(registry, resolution, accounts, {
              checkSecrets: false,
            })
          ).namespaces,
        ),
      },
      registry,
    );
    const tools = withAgentProfiles(
      selected,
      profiles,
      Boolean(
        input.conversation.id && options.hasChildren(input.conversation.id),
      ),
    ).map((tool) => ({
      ...tool,
      description:
        resolveSkillPlaceholders(
          tool.name === "quick_script" ? quickScriptText : tool.description,
        ) +
        (tool.name === "plan_present"
          ? `\n\nWrite the plan under: ${join(options.home, "data", "plans")}`
          : ""),
    }));
    const enabled = (source: "file" | "nerve" | "agentBrowser") =>
      Object.entries(settings.skills?.[source] ?? {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
    const resources = await loadHarnessResources(
      input.config.workingDirectory,
      {
        projectDir: input.projectDir,
        storageHome: options.home,
        projectSkills: {
          trust: options.projectSkillTrust,
          projectId: input.conversation.projectId,
        },
        nerveSkills: options.nerveSkills(),
        agentBrowserSkills: options.agentBrowserSkills(),
        enabledFileSkillNames: enabled("file"),
        enabledNerveSkillNames: enabled("nerve"),
        enabledAgentBrowserSkillNames: enabled("agentBrowser"),
        disabledSkillNames: Object.entries(settings.skills?.file ?? {})
          .filter(([, enabled]) => !enabled)
          .map(([name]) => name),
      },
    );
    const promptInstructions = [instructions, input.config.instructions]
      .filter(Boolean)
      .map((value) => resolveSkillPlaceholders(value!))
      .join("\n\n");
    return {
      tools,
      systemPrompt: buildNerveSystemPrompt({
        systemPrompt: input.config.systemPrompt,
        cwd: input.config.workingDirectory,
        selectedTools: tools.map((tool) => tool.name),
        agentProfiles: profiles,
        contextFiles: resources.contextFiles,
        skills: resources.skills,
        instructions: promptInstructions,
        appendSystemPrompt: resources.appendSystemPrompt,
      }),
    };
  };
}
