import type { TurnResourcesPort } from "@nervekit/conversation-core";
import type { Skill } from "@nervekit/harness/resources";
import type { ToolDefinition } from "@nervekit/tools/catalog";
import { promptGuidelinesForTools } from "@nervekit/tools/catalog";
import { loadHarnessResources } from "./resource-loader.js";
import { buildNerveSystemPrompt } from "./nerve-system-prompt.js";
import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import type { CapabilityService } from "./capability.service.js";
import { join } from "node:path";

export function createTurnResourcesPort(options: {
  home: string;
  tools(): ToolDefinition[];
  skills: readonly Skill[];
  agentBrowserSkills: readonly Skill[];
  capabilities: CapabilityService;
}): TurnResourcesPort {
  return {
    async prepare({ conversation, config, projectDir, coreTools = [] }) {
      const { effective, availableTools, toolProfileOptions } =
        await options.capabilities.configuration(
          conversation.projectId,
          conversation.id,
        );
      const tools = [...options.tools(), ...coreTools].filter((tool) => {
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
            customPrompt: resources.systemPrompt,
            appendSystemPrompt: resources.appendSystemPrompt,
            planDir: join(options.home, "data", "plans"),
          }),
      };
    },
  };
}
