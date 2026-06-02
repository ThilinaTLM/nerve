import type { ToolDescriptor, ToolName, ToolRisk } from "@nerve/shared";
import {
  coreToolDescriptorsFromDefinitions,
  coreToolRiskForName,
} from "./definitions.js";

export * from "./definitions.js";
export { executeTool, resolveToolPath } from "./execution/index.js";
export {
  hasDangerousCommandPattern,
  hasShellControlOperator,
  isKnownReadOnlyCommand,
  isLikelyLongRunningCommand,
} from "./safety/command-policy.js";
export * from "./types.js";

export const coreToolDescriptors: ToolDescriptor[] =
  coreToolDescriptorsFromDefinitions();

export function toolRiskForName(name: ToolName): ToolRisk {
  return coreToolRiskForName(name);
}
