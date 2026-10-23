import { join } from "node:path";
import type { BashToolSettings } from "@nervekit/contracts/settings";
import { subagentBlockedToolNames } from "@nervekit/contracts/subagents";
import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { ConfigurationPreviewInput } from "@nervekit/conversation-core";
import type { ToolDefinition } from "@nervekit/tools/catalog";
import type { Skill } from "@nervekit/harness/resources";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { loadHarnessResources } from "./resource-loader.js";
import { buildNerveSystemPrompt } from "./nerve-system-prompt.js";
import { withAgentProfiles } from "./turn-resources.adapter.js";
import { resolveSkillPlaceholders } from "@nervekit/skills";

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
  hasChildren(id: string): boolean;
}) {
  return async (
    input: ConfigurationPreviewInput,
    settings: LeadSettingsOverrides,
    instructions: string,
    missingReferences: readonly string[] = [],
  ) => {
    const child = input.conversation.parentConversationId !== null;
    const selected = [
      ...(await options.tools(
        input.projectDir,
        input.conversation.id,
        settings.tools?.bash?.settings as BashToolSettings,
      )),
      ...input.coreTools,
    ].filter((tool) => {
      if (child && blocked.has(tool.name)) return false;
      const name = tool.name.startsWith("subagent_")
        ? "subagents"
        : tool.name.startsWith("jira_")
          ? "jira"
          : tool.name.startsWith("confluence_")
            ? "confluence"
            : tool.name;
      if (
        missingReferences.some((pointer) =>
          pointer.startsWith(`/tools/${name}/`),
        )
      )
        return false;
      const parsed = capabilityToolNameSchema.safeParse(name);
      if (!parsed.success || parsed.data === "bash") return true;
      const entry = settings.tools?.[parsed.data];
      return Boolean(entry && "enabled" in entry && entry.enabled);
    });
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
            description: profile.definition.description,
            permission: "Independent child policy",
          });
      }
    const tools = withAgentProfiles(
      selected,
      profiles,
      Boolean(
        input.conversation.id && options.hasChildren(input.conversation.id),
      ),
    ).map((tool) => ({
      ...tool,
      description:
        resolveSkillPlaceholders(tool.description) +
        (tool.name === "plan_present"
          ? ` Plan storage: ${join(options.home, "data", "plans")}.`
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
