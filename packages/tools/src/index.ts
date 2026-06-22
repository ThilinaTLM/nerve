import type { ToolDescriptor, ToolName, ToolRisk } from "@nerve/shared";
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
  boundLiveOutputChunk,
  boundText,
  buildProcessResult,
  buildProcessTextResult,
  executeEdit,
  executeLegacyEdit,
  executeTool,
  FILE_OUTPUT_MAX_LINE_CHARS,
  LIVE_OUTPUT_MAX_BYTES,
  LIVE_OUTPUT_MAX_LINE_CHARS,
  LIVE_OUTPUT_MAX_LINES,
  MODEL_TEXT_MAX_BYTES,
  MODEL_TEXT_MAX_LINE_CHARS,
  MODEL_TEXT_MAX_LINES,
  normalizeEditArgs,
  normalizeLegacyEditOperations,
  PROCESS_INLINE_MAX_LINE_CHARS,
  type PythonRuntime,
  type PythonRuntimeStatus,
  resolvePythonRuntime,
  resolveToolPath,
  type TextBoundaryDetails,
  type TextBudget,
  ToolExecutionError,
  textBoundaryDetails,
} from "./execution/index.js";
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
