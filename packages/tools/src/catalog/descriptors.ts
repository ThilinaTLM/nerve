import type { ToolDescriptor } from "@nervekit/contracts";
import { coreToolDefinitions, toolManifest } from "./manifest.js";
import { permissionMetadataForTool } from "./permission-metadata.js";
import type {
  ToolDefinition,
  ToolPermissionTargetDescriptor,
} from "./types.js";

function ruleKind(
  target: ToolPermissionTargetDescriptor | undefined,
): ToolDescriptor["permission"]["ruleKind"] {
  if (target?.kind === "path") return "path_glob";
  if (target?.kind === "command_segments") return "command_glob";
  if (target?.kind === "web_host") return "url_glob";
  return "tool";
}

function descriptor(definition: ToolDefinition): ToolDescriptor {
  const metadata = permissionMetadataForTool(definition.name);
  return {
    name: definition.name,
    kind: metadata.kind,
    groups: [...metadata.groups],
    baseRisk: metadata.baseRisk,
    primaryArguments: [...metadata.primaryArguments],
    targetKinds: [...metadata.targetKinds],
    risk: definition.baseRisk,
    argumentSensitive: Boolean(definition.classifyRisk),
    description: definition.description,
    group: definition.group,
    executionKind: definition.executionKind,
    traits: [...definition.traits],
    permission: {
      durableAllow: definition.permission?.durableAllow ?? "tool",
      ruleKind: ruleKind(definition.permission?.targets?.[0]),
    },
  };
}

export function coreToolDescriptorsFromDefinitions(): ToolDescriptor[] {
  return coreToolDefinitions.map(descriptor);
}

export function allToolDescriptorsFromDefinitions(): ToolDescriptor[] {
  return toolManifest.map(descriptor);
}
