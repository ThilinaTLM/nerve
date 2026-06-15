import type { ToolDescriptor, ToolName, ToolRisk } from "@nerve/shared";
import {
  allToolDescriptorsFromDefinitions,
  coreToolDescriptorsFromDefinitions,
  coreToolRiskForName,
} from "./catalog/index.js";

export * from "./catalog/index.js";
export {
  executeTool,
  type PythonRuntime,
  type PythonRuntimeStatus,
  resolvePythonRuntime,
  resolveToolPath,
} from "./execution/index.js";
export {
  hasDangerousCommandPattern,
  hasShellControlOperator,
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
