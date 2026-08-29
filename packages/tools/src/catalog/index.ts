import type { CoreToolName } from "@nervekit/contracts/tools";
import { coreToolDefinitions } from "./manifest.js";
import type { ToolDefinition } from "./contracts.js";

export * from "./definitions/core/confluence.tools.js";
export * from "./definitions/core/filesystem.tools.js";
export * from "./definitions/core/interaction.tools.js";
export * from "./definitions/core/jira.tools.js";
export * from "./definitions/core/python.tools.js";
export * from "./definitions/core/shell.tools.js";
export * from "./definitions/core/web.tools.js";
export * from "./descriptors.js";
export * from "./manifest.js";
export * from "./argument-normalization.js";
export * from "./definitions/orchestration/explore.tools.js";
export * from "./definitions/orchestration/plan-mode.tools.js";
export * from "./definitions/orchestration/task.tools.js";
export * from "./prompt-guidelines.js";
export * from "./risk.js";
export * from "./contracts.js";

export function coreToolDefinitionByName(name: CoreToolName): ToolDefinition {
  const definition = coreToolDefinitions.find((tool) => tool.name === name);
  if (!definition) throw new Error(`Unknown core tool: ${name}`);
  return definition;
}
