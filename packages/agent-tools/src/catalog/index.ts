import type { CoreToolName } from "@nervekit/contracts";
import { coreToolDefinitions } from "./manifest.js";
import type { ToolDefinition } from "./types.js";

export * from "./core/confluence.tools.js";
export * from "./core/filesystem.tools.js";
export * from "./core/interaction.tools.js";
export * from "./core/jira.tools.js";
export * from "./core/python.tools.js";
export * from "./core/shell.tools.js";
export * from "./core/web.tools.js";
export * from "./descriptors.js";
export * from "./manifest.js";
export * from "./orchestration/explore.tools.js";
export * from "./orchestration/plan-mode.tools.js";
export * from "./orchestration/task.tools.js";
export * from "./risk.js";
export * from "./types.js";

export function coreToolDefinitionByName(name: CoreToolName): ToolDefinition {
  const definition = coreToolDefinitions.find((tool) => tool.name === name);
  if (!definition) throw new Error(`Unknown core tool: ${name}`);
  return definition;
}
