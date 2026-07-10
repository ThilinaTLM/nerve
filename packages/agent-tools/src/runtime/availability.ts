import type { ToolGroupName, ToolName } from "@nervekit/contracts";
import { toolManifest } from "../catalog/manifest.js";
import type { ToolAvailabilityInput } from "./types.js";

export type ToolAvailability = {
  activeToolNames: ToolName[];
  unavailableToolNames: ToolName[];
  groups: Array<{
    group: ToolGroupName;
    tools: ToolName[];
    unavailableTools: ToolName[];
  }>;
};

export function resolveToolAvailability(
  input: ToolAvailabilityInput = {},
): ToolAvailability {
  const enabledNames = input.enabledNames
    ? new Set<ToolName>(input.enabledNames)
    : undefined;
  const disabledNames = new Set<ToolName>(input.disabledNames ?? []);
  const enabledGroups = input.enabledGroups
    ? new Set<ToolGroupName>(input.enabledGroups)
    : undefined;
  const disabledGroups = new Set<ToolGroupName>(input.disabledGroups ?? []);
  const unavailable = new Set<ToolName>(input.unavailableNames ?? []);

  for (const definition of toolManifest) {
    const capability = input.capabilityForTool?.[definition.name];
    if (capability && input.capabilities?.[capability] !== true) {
      unavailable.add(definition.name);
    }
    if (
      definition.executionKind === "host" &&
      input.includeHostTools === false
    ) {
      unavailable.add(definition.name);
    }
  }

  const activeToolNames = toolManifest
    .filter((definition) => {
      if (enabledNames && !enabledNames.has(definition.name)) return false;
      if (disabledNames.has(definition.name)) return false;
      if (enabledGroups && !enabledGroups.has(definition.group)) return false;
      if (disabledGroups.has(definition.group)) return false;
      if (unavailable.has(definition.name)) return false;
      if (
        input.permissionLevel === "read_only" &&
        (definition.traits.includes("write_capable") ||
          [
            "command",
            "network",
            "secret",
            "destructive",
            "agent_spawn",
            "deployment",
          ].includes(definition.baseRisk))
      ) {
        return false;
      }
      return true;
    })
    .map((definition) => definition.name);

  const groups = [
    ...new Set(toolManifest.map((definition) => definition.group)),
  ].map((group) => ({
    group,
    tools: activeToolNames.filter(
      (name) =>
        toolManifest.find((definition) => definition.name === name)?.group ===
        group,
    ),
    unavailableTools: [...unavailable].filter(
      (name) =>
        toolManifest.find((definition) => definition.name === name)?.group ===
        group,
    ),
  }));

  return {
    activeToolNames,
    unavailableToolNames: [...unavailable],
    groups,
  };
}
