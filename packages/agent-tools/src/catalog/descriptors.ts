import type { ToolDescriptor } from "@nervekit/contracts";
import { coreToolDefinitions, toolManifest } from "./manifest.js";
import type { ToolDefinition } from "./types.js";

function descriptor(definition: ToolDefinition): ToolDescriptor {
  return {
    name: definition.name,
    risk: definition.baseRisk,
    description: definition.description,
    group: definition.group,
    executionKind: definition.executionKind,
    traits: [...definition.traits],
  };
}

export function coreToolDescriptorsFromDefinitions(): ToolDescriptor[] {
  return coreToolDefinitions.map(descriptor);
}

export function allToolDescriptorsFromDefinitions(): ToolDescriptor[] {
  return toolManifest.map(descriptor);
}
