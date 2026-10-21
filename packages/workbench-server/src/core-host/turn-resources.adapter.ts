import { subagentBlockedToolNames } from "@nervekit/contracts/subagents";
import type { TurnResourcesPort } from "@nervekit/conversation-core";
import type { Skill } from "@nervekit/harness/resources";
import type { ToolDefinition } from "@nervekit/tools/catalog";
import { resolveSkillPlaceholders } from "@nervekit/skills";
import { listPermissionRuleSets } from "./permission-rule-sets.js";
import { loadHarnessResources } from "./resource-loader.js";
import { buildNerveSystemPrompt } from "./nerve-system-prompt.js";
import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import type { CapabilityService } from "./capability.service.js";
import { join } from "node:path";
import { type AgentProfile } from "@nervekit/contracts/agent-profiles";
import {
  isUsable,
  type AgentProfileService,
} from "../domains/agent-profiles/agent-profile.service.js";

const blocked: ReadonlySet<string> = new Set(subagentBlockedToolNames);

/**
 * `subagent_prompt` offers exactly the profiles usable now as an enum.
 * With none usable, retain only existing-agent workflows.
 * Schemas are rebuilt by spreading so typebox's symbol markers survive.
 */
export function withAgentProfiles(
  tools: ToolDefinition[],
  usable: readonly Pick<AgentProfile, "name" | "description">[],
  hasExistingSubagents = false,
): ToolDefinition[] {
  if (!usable.length && !hasExistingSubagents)
    return tools.filter((tool) => !tool.name.startsWith("subagent_"));
  return tools.map((tool) => {
    if (tool.name !== "subagent_prompt") return tool;
    const parameters = tool.parameters as unknown as ObjectSchema;
    const assignments = parameters.properties.assignments as AssignmentsSchema;
    const assignmentProperties = usable.length
      ? {
          ...assignments.items.properties,
          profile: {
            type: "string",
            enum: usable.map((entry) => entry.name),
          },
        }
      : Object.fromEntries(
          Object.entries(assignments.items.properties).filter(
            ([name]) => name !== "profile",
          ),
        );
    return {
      ...tool,
      ...(usable.length
        ? {}
        : {
            description:
              "Queue follow-up work for existing sub-agents by name. No profiles are currently usable, so new sub-agents cannot be created. Existing sub-agents keep their configuration and run asynchronously; completion notices wake you.",
          }),
      parameters: {
        ...parameters,
        properties: {
          ...parameters.properties,
          assignments: {
            ...assignments,
            items: {
              ...assignments.items,
              properties: assignmentProperties,
            },
          },
        },
      },
    } as unknown as ToolDefinition;
  });
}

type ObjectSchema = {
  properties: Record<string, unknown>;
};
type AssignmentsSchema = {
  items: ObjectSchema;
};

export function createTurnResourcesPort(options: {
  home: string;
  tools(projectDir: string): ToolDefinition[] | Promise<ToolDefinition[]>;
  skillCatalogs: {
    nerve: { readonly skills: readonly Skill[] };
    agentBrowser: { readonly skills: readonly Skill[] };
  };
  capabilities: CapabilityService;
  agentProfiles: Pick<AgentProfileService, "usable" | "preview" | "list">;
  defaultProfile?(projectId: string): Promise<string>;
  hasExistingSubagents(conversationId: string): boolean | Promise<boolean>;
}): TurnResourcesPort {
  return {
    async prepare({
      conversation,
      config,
      projectDir,
      coreTools = [],
      capabilityOverrides,
      agentProfileOverrides,
    }) {
      const isChild = conversation.parentConversationId !== null;
      const profiles = conversation.id
        ? await options.agentProfiles.list(
            conversation.projectId,
            conversation.id,
          )
        : (
            await options.agentProfiles.preview({
              projectId: conversation.projectId,
              document: agentProfileOverrides ?? {
                schemaVersion: 1,
                profiles: {},
              },
              lead: {
                model: config.model,
                reasoningLevel: config.reasoningLevel,
              },
              capabilityOverrides,
            })
          ).profiles.flatMap(({ effective }) => (effective ? [effective] : []));
      const awaitDefault = options.defaultProfile
        ? await options.defaultProfile(conversation.projectId)
        : "coding";
      const active =
        profiles.find(
          (p) =>
            p.name === config.agentProfile &&
            isUsable(p) &&
            (isChild || p.usableBy !== "subagent"),
        ) ??
        (!isChild
          ? profiles.find(
              (p) =>
                p.name === awaitDefault &&
                isUsable(p) &&
                p.usableBy !== "subagent",
            )
          : undefined);
      const { effective, availableTools, toolProfileOptions } =
        await options.capabilities.configuration(
          conversation.projectId,
          conversation.id,
          capabilityOverrides,
          !isChild ? active : undefined,
          {
            nerve: options.skillCatalogs.nerve.skills,
            agentBrowser: options.skillCatalogs.agentBrowser.skills,
          },
        );
      const selected = [
        ...(await options.tools(projectDir)),
        ...coreTools,
      ].filter((tool) => !(isChild && blocked.has(tool.name)));
      const filtered = selected.filter((tool) => {
        const name = tool.name.startsWith("subagent_")
          ? "subagents"
          : tool.name.startsWith("jira_")
            ? "jira"
            : tool.name.startsWith("confluence_")
              ? "confluence"
              : tool.name;
        const parsed = capabilityToolNameSchema.safeParse(name);
        if (
          (name === "jira" || name === "confluence") &&
          !toolProfileOptions[name].some(
            (profile) => profile.id === effective.toolProfiles[name],
          )
        )
          return false;
        return (
          !parsed.success ||
          (availableTools.includes(parsed.data) &&
            !effective.disabledTools.includes(parsed.data))
        );
      });
      const hasSubagentPrompt = filtered.some(
        (tool) => tool.name === "subagent_prompt",
      );
      const usable = hasSubagentPrompt
        ? conversation.id
          ? await options.agentProfiles.usable({
              projectId: conversation.projectId,
              conversationId: conversation.id,
              parentConfig: { ...config, conversationId: conversation.id },
            })
          : (
              await options.agentProfiles.preview({
                projectId: conversation.projectId,
                document: agentProfileOverrides ?? {
                  schemaVersion: 1,
                  profiles: {},
                },
                lead: {
                  model: config.model,
                  reasoningLevel: config.reasoningLevel,
                },
                capabilityOverrides,
              })
            ).profiles.flatMap(({ effective }) =>
              effective && isUsable(effective) && effective.usableBy !== "lead"
                ? [effective]
                : [],
            )
        : [];
      const tools = (
        hasSubagentPrompt
          ? withAgentProfiles(
              filtered,
              usable,
              conversation.id
                ? await options.hasExistingSubagents(conversation.id)
                : false,
            )
          : filtered
      ).map((tool) => ({
        ...tool,
        description:
          resolveSkillPlaceholders(tool.description) +
          (tool.name === "plan_present"
            ? ` Plan storage: ${join(options.home, "data", "plans")}.`
            : ""),
      }));
      const ruleSets = usable.length
        ? await listPermissionRuleSets(options.home)
        : [];
      const agentProfiles = usable.map((profile) => ({
        name: profile.name,
        description: profile.description,
        permission:
          ruleSets.find(
            (ruleSet) =>
              ruleSet.id ===
              (typeof profile.permission === "object"
                ? profile.permission.lock
                : profile.permission),
          )?.name ??
          (typeof profile.permission === "object"
            ? profile.permission.lock
            : profile.permission),
      }));
      const resources = await loadHarnessResources(projectDir, {
        storageHome: options.home,
        nerveSkills: options.skillCatalogs.nerve.skills,
        agentBrowserSkills: options.skillCatalogs.agentBrowser.skills,
        enabledNerveSkillNames: effective.enabledNerveSkills,
        enabledAgentBrowserSkillNames: effective.enabledAgentBrowserSkills,
        disabledSkillNames: effective.disabledFileSkills,
      });
      const skills = resources.skills;
      return {
        tools,
        systemPrompt:
          config.systemPrompt ??
          buildNerveSystemPrompt({
            cwd: config.workingDirectory,
            selectedTools: tools.map((tool) => tool.name),
            agentProfiles,
            contextFiles: resources.contextFiles,
            skills,
            instructions: [
              !isChild ? active?.instructions : undefined,
              config.instructions,
            ]
              .filter(Boolean)
              .map((text) => resolveSkillPlaceholders(text!))
              .join("\n\n"),
            customPrompt: resources.systemPrompt,
            appendSystemPrompt: resources.appendSystemPrompt,
          }),
      };
    },
  };
}
