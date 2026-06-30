import type { CoreToolName } from "@nervekit/shared";
import { filesystemToolDefinitions } from "./core/filesystem.tools.js";
import { interactionToolDefinitions } from "./core/interaction.tools.js";
import { jiraToolDefinitions } from "./core/jira.tools.js";
import { pythonToolDefinitions } from "./core/python.tools.js";
import { shellToolDefinitions } from "./core/shell.tools.js";
import { webToolDefinitions } from "./core/web.tools.js";
import { exploreToolDefinitions } from "./orchestration/explore.tools.js";
import { planModeToolDefinitions } from "./orchestration/plan-mode.tools.js";
import { taskToolDefinitions } from "./orchestration/task.tools.js";
import type { CoreToolDefinition } from "./types.js";

export * from "./core/filesystem.tools.js";
export * from "./core/interaction.tools.js";
export * from "./core/jira.tools.js";
export * from "./core/python.tools.js";
export * from "./core/shell.tools.js";
export * from "./core/web.tools.js";
export * from "./descriptors.js";
export * from "./orchestration/explore.tools.js";
export * from "./orchestration/plan-mode.tools.js";
export * from "./orchestration/task.tools.js";
export * from "./risk.js";
export * from "./types.js";

const [readToolDefinition, ...remainingFilesystemToolDefinitions] =
  filesystemToolDefinitions as CoreToolDefinition[];

export const coreToolDefinitions: CoreToolDefinition[] = [
  ...(readToolDefinition ? [readToolDefinition] : []),
  ...shellToolDefinitions,
  ...pythonToolDefinitions,
  ...remainingFilesystemToolDefinitions,
  ...interactionToolDefinitions,
  ...webToolDefinitions,
  ...jiraToolDefinitions,
];

export const orchestrationToolDefinitions: CoreToolDefinition[] = [
  ...taskToolDefinitions,
  ...exploreToolDefinitions,
  ...planModeToolDefinitions,
];

export const allToolDefinitions: CoreToolDefinition[] = [
  ...coreToolDefinitions,
  ...orchestrationToolDefinitions,
];

export function coreToolDefinitionByName(
  name: CoreToolName,
): CoreToolDefinition {
  const definition = coreToolDefinitions.find((tool) => tool.name === name);
  if (!definition) throw new Error(`Unknown core tool: ${name}`);
  return definition;
}
