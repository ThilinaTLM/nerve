import {
  type ToolGroupName,
  type ToolName,
  type ToolRisk,
  type ToolTrait,
  toolGroupNameSchema,
} from "@nervekit/contracts";
import { confluenceToolDefinitions } from "./core/confluence.tools.js";
import { filesystemToolDefinitions } from "./core/filesystem.tools.js";
import { interactionToolDefinitions } from "./core/interaction.tools.js";
import { jiraToolDefinitions } from "./core/jira.tools.js";
import { pythonToolDefinitions } from "./core/python.tools.js";
import { shellToolDefinitions } from "./core/shell.tools.js";
import { webToolDefinitions } from "./core/web.tools.js";
import { exploreToolDefinitions } from "./orchestration/explore.tools.js";
import { planModeToolDefinitions } from "./orchestration/plan-mode.tools.js";
import { taskToolDefinitions } from "./orchestration/task.tools.js";
import {
  type HostToolDefinition,
  isHostToolDefinition,
  isLocalToolDefinition,
  type LocalToolDefinition,
  type ToolDefinition,
} from "./types.js";

const [readToolDefinition, ...remainingFilesystemToolDefinitions] =
  filesystemToolDefinitions;

export const coreToolDefinitions: readonly ToolDefinition[] = Object.freeze([
  ...(readToolDefinition ? [readToolDefinition] : []),
  ...shellToolDefinitions,
  ...pythonToolDefinitions,
  ...remainingFilesystemToolDefinitions,
  ...interactionToolDefinitions,
  ...webToolDefinitions,
  ...jiraToolDefinitions,
  ...confluenceToolDefinitions,
]);

export const orchestrationToolDefinitions: readonly ToolDefinition[] =
  Object.freeze([
    ...taskToolDefinitions,
    ...exploreToolDefinitions,
    ...planModeToolDefinitions,
  ]);

export const toolManifest: readonly ToolDefinition[] = Object.freeze([
  ...coreToolDefinitions,
  ...orchestrationToolDefinitions,
]);

/** Existing public name retained for callers that consume the complete catalog. */
export const allToolDefinitions = toolManifest;

const definitionByName = new Map<ToolName, ToolDefinition>();
for (const definition of toolManifest) {
  if (definitionByName.has(definition.name)) {
    throw new Error(`Duplicate tool definition: ${definition.name}`);
  }
  if (!definition.group || !definition.baseRisk || !definition.executionKind) {
    throw new Error(`Incomplete tool metadata: ${definition.name}`);
  }
  if (
    definition.executionKind === "local" &&
    typeof (definition as { executor?: unknown }).executor !== "function"
  ) {
    throw new Error(`Local tool has no executor: ${definition.name}`);
  }
  Object.freeze(definition.traits);
  Object.freeze(definition);
  definitionByName.set(definition.name, definition);
}

export function toolDefinitionByName(
  name: ToolName | string,
): ToolDefinition | undefined {
  return definitionByName.get(name as ToolName);
}

export function requireToolDefinition(name: ToolName | string): ToolDefinition {
  const definition = toolDefinitionByName(name);
  if (!definition) throw new Error(`Unknown tool: ${name}`);
  return definition;
}

export function toolDefinitionsByGroup(
  group: ToolGroupName,
): readonly ToolDefinition[] {
  return toolManifest.filter((definition) => definition.group === group);
}

export const toolGroups: readonly ToolGroupName[] = Object.freeze(
  toolGroupNameSchema.options.filter((group) =>
    toolManifest.some((definition) => definition.group === group),
  ),
);

export const localToolDefinitions: readonly LocalToolDefinition[] =
  Object.freeze(toolManifest.filter(isLocalToolDefinition));

export const hostToolDefinitions: readonly HostToolDefinition[] = Object.freeze(
  toolManifest.filter(isHostToolDefinition),
);

export function classifyToolRisk(
  name: ToolName | string,
  args: Record<string, unknown> = {},
): ToolRisk {
  const definition = requireToolDefinition(name);
  return definition.classifyRisk?.(args) ?? definition.baseRisk;
}

export function toolHasTrait(
  name: ToolName | string,
  trait: ToolTrait,
): boolean {
  return requireToolDefinition(name).traits.includes(trait);
}

export function isLocalToolName(name: ToolName | string): boolean {
  return toolDefinitionByName(name)?.executionKind === "local";
}

export function isHostToolName(name: ToolName | string): boolean {
  return toolDefinitionByName(name)?.executionKind === "host";
}
