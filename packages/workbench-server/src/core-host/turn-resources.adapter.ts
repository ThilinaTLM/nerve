import type { TurnResourcesPort } from "@nervekit/conversation-core";
import type { Skill } from "@nervekit/harness/resources";
import type { ToolDefinition } from "@nervekit/tools/catalog";
import { promptGuidelinesForTools } from "@nervekit/tools/catalog";
import { loadHarnessResources } from "./resource-loader.js";
import { buildNerveSystemPrompt } from "./nerve-system-prompt.js";
import { join } from "node:path";

export function createTurnResourcesPort(options: {
  home: string;
  tools(): ToolDefinition[];
  skills: readonly Skill[];
}): TurnResourcesPort {
  return {
    async prepare({ config, projectDir }) {
      const tools = options
        .tools()
        .filter(
          (tool) =>
            config.enabledTools === null ||
            config.enabledTools.includes(tool.name),
        );
      const resources = await loadHarnessResources(projectDir, {
        storageHome: options.home,
        nerveSkills: options.skills,
        enabledNerveSkillNames: options.skills.map((skill) => skill.name),
      });
      const skills = resources.skills.filter(
        (skill) =>
          config.enabledSkills === null ||
          config.enabledSkills.includes(skill.name),
      );
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
