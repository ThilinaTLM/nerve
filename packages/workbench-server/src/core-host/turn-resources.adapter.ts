import type { TurnResourcesPort } from "@nervekit/conversation-core";
import type { Skill } from "@nervekit/harness/resources";
import type { ToolDefinition } from "@nervekit/tools/catalog";
import { promptGuidelinesForTools } from "@nervekit/tools/catalog";
import { loadHarnessResources } from "./resource-loader.js";
import { buildNerveSystemPrompt } from "./nerve-system-prompt.js";
import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import type { CapabilityService } from "./capability.service.js";
import { join } from "node:path";
import {
  subagentBlockedToolNames,
  type SubagentProfile,
} from "@nervekit/contracts/subagents";
import type { SubagentProfileService } from "../domains/subagents/subagent-profile.service.js";

const blocked: ReadonlySet<string> = new Set(subagentBlockedToolNames);

/**
 * `subagent_prompt` offers exactly the profiles usable now: an enum with a
 * `name — description` list. With none usable, retain only existing-agent workflows.
 * Schemas are rebuilt by spreading so typebox's symbol markers survive.
 */
export function withSubagentProfiles(
  tools: ToolDefinition[],
  usable: readonly Pick<SubagentProfile, "name" | "description">[],
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
            description: `Profile for a new sub-agent. Usable profiles:\n${usable
              .map((entry) => `${entry.name} — ${entry.description}`)
              .join("\n")}`,
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
  skills: readonly Skill[];
  agentBrowserSkills: readonly Skill[];
  capabilities: CapabilityService;
  subagentProfiles: Pick<SubagentProfileService, "usable">;
  hasExistingSubagents(conversationId: string): boolean | Promise<boolean>;
}): TurnResourcesPort {
  return {
    async prepare({ conversation, config, projectDir, coreTools = [] }) {
      const { effective, availableTools, toolProfileOptions } =
        await options.capabilities.configuration(
          conversation.projectId,
          conversation.id,
        );
      const isChild = conversation.parentConversationId !== null;
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
      const tools = filtered.some((tool) => tool.name === "subagent_prompt")
        ? withSubagentProfiles(
            filtered,
            await options.subagentProfiles.usable({
              projectId: conversation.projectId,
              conversationId: conversation.id,
            }),
            await options.hasExistingSubagents(conversation.id),
          )
        : filtered;
      const resources = await loadHarnessResources(projectDir, {
        storageHome: options.home,
        nerveSkills: options.skills,
        agentBrowserSkills: options.agentBrowserSkills,
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
            mode: config.mode,
            selectedTools: tools.map((tool) => tool.name),
            promptGuidelines: promptGuidelinesForTools(
              tools.map((tool) => tool.name),
            ),
            contextFiles: resources.contextFiles,
            skills,
            instructions: config.instructions,
            customPrompt: resources.systemPrompt,
            appendSystemPrompt: resources.appendSystemPrompt,
            planDir: join(options.home, "data", "plans"),
          }),
      };
    },
  };
}
