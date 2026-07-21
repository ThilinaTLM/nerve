import type { ToolDescriptor, ToolName, ToolRisk } from "@nervekit/contracts";
import {
  allToolDescriptorsFromDefinitions,
  coreToolDescriptorsFromDefinitions,
  coreToolRiskForName,
} from "./catalog/index.js";

export * from "./catalog/index.js";
export {
  appendBoundedTextNotice,
  type BoundedTextResult,
  boundContentBlocks,
  type ContentBlockLike,
  boundLiveOutputChunk,
  boundText,
  buildProcessResult,
  buildProcessTextResult,
  executeBash,
  executeEdit,
  executeTool,
  FILE_OUTPUT_MAX_LINE_CHARS,
  LIVE_OUTPUT_MAX_BYTES,
  LIVE_OUTPUT_MAX_LINE_CHARS,
  LIVE_OUTPUT_MAX_LINES,
  MODEL_TOOL_RESULT_MAX_BYTES,
  MODEL_TEXT_MAX_LINE_CHARS,
  MODEL_TEXT_MAX_LINES,
  normalizeEditArgs,
  PROCESS_INLINE_MAX_LINE_CHARS,
  type PythonRuntime,
  type PythonRuntimeStatus,
  type ResolveBashShellConfigOptions,
  resolveBashShellConfig,
  resolveCommandCwd,
  resolvePythonRuntime,
  resolveToolPath,
  type ShellConfig,
  type TextBoundaryDetails,
  type TextBudget,
  ToolExecutionError,
  textBoundaryDetails,
  textLimitSnapshot,
} from "./execution/index.js";
export * from "./git/git-branches.js";
export * from "./git/git-command.js";
export * from "./git/git-errors.js";
export * from "./git/git-github-parsers.js";
export * from "./git/git-github-service.js";
export * from "./git/git-observability.js";
export * from "./git/git-service.js";
export * from "./git/git-status.js";
export * from "./runtime/index.js";
export {
  hasDangerousCommandPattern,
  hasShellControlOperator,
  isAllowedPlanModeBashCommand,
  isKnownReadOnlyCommand,
  isLikelyLongRunningCommand,
} from "./safety/command-policy.js";
export * from "./types.js";

export const coreToolDescriptors: ToolDescriptor[] =
  coreToolDescriptorsFromDefinitions();

export const allToolDescriptors: ToolDescriptor[] =
  allToolDescriptorsFromDefinitions();

export function toolRiskForName(name: ToolName): ToolRisk {
  return coreToolRiskForName(name);
}
