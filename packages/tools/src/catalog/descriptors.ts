import type { ToolDescriptor } from "@nervekit/shared";
import { allToolDefinitions, coreToolDefinitions } from "./index.js";
import { coreToolRiskForName } from "./risk.js";

export function coreToolDescriptorsFromDefinitions(): ToolDescriptor[] {
  return coreToolDefinitions.map((definition) => ({
    name: definition.name,
    risk: coreToolRiskForName(definition.name),
    description: definition.description,
  }));
}

export function allToolDescriptorsFromDefinitions(): ToolDescriptor[] {
  return allToolDefinitions.map((definition) => ({
    name: definition.name,
    risk: coreToolRiskForName(definition.name),
    description: definition.description,
  }));
}
