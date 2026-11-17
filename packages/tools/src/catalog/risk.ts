import type { ToolName } from "@nervekit/contracts/tools";
import type { ToolRisk } from "@nervekit/contracts/permissions";
import {
  classifyToolRisk,
  classifyToolRiskAsync,
  requireToolDefinition,
} from "./manifest.js";

export function coreToolRiskForName(name: ToolName): ToolRisk {
  return requireToolDefinition(name).baseRisk;
}

export function isReadOnlyNetworkToolForApproval(name: ToolName): boolean {
  return requireToolDefinition(name).traits.includes("read_only_network");
}

export { classifyToolRisk, classifyToolRiskAsync };
