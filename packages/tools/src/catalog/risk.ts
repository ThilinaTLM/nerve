import type { ToolName, ToolRisk } from "@nervekit/contracts";
import { classifyToolRisk, requireToolDefinition } from "./manifest.js";

export function coreToolRiskForName(name: ToolName): ToolRisk {
  return requireToolDefinition(name).baseRisk;
}

export function isReadOnlyNetworkToolForApproval(name: ToolName): boolean {
  return requireToolDefinition(name).traits.includes("read_only_network");
}

export { classifyToolRisk };
