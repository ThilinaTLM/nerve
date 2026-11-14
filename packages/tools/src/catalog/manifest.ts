import { subagentToolDefinitions } from "./definitions/orchestration/subagent.tools.js";
import {
  type ToolGroupName,
  type ToolName,
  type ToolTrait,
} from "@nervekit/contracts/tools";
import { type ToolRisk } from "@nervekit/contracts/permissions";
import { filesystemToolDefinitions } from "./definitions/core/filesystem.tools.js";
import { interactionToolDefinitions } from "./definitions/core/interaction.tools.js";
import { pythonToolDefinitions } from "./definitions/core/python.tools.js";
import { shellToolDefinitions } from "./definitions/core/shell.tools.js";
import { webToolDefinitions } from "./definitions/core/web.tools.js";
import { visionToolDefinitions } from "./definitions/core/vision.tools.js";
import { planPresentToolDefinitions } from "./definitions/orchestration/plan-present.tools.js";
import { processToolDefinitions } from "./definitions/orchestration/process.tools.js";
import { agentResultPolicyForTool } from "../result-projection/policies/index.js";
import {
  permissionMetadataForTool,
  registerExtensionToolMetadata,
} from "./permission-metadata.js";
import {
  type HostToolDefinition,
  isHostToolDefinition,
  isLocalToolDefinition,
  type LocalToolDefinition,
  type ToolDefinition,
} from "./contracts.js";

const [readToolDefinition, ...remainingFilesystemToolDefinitions] =
  filesystemToolDefinitions;

const rawCoreToolDefinitions: readonly ToolDefinition[] = [
  ...(readToolDefinition ? [readToolDefinition] : []),
  ...shellToolDefinitions,
  ...pythonToolDefinitions,
  ...remainingFilesystemToolDefinitions,
  ...interactionToolDefinitions,
  ...webToolDefinitions,
  ...visionToolDefinitions,
];

// Live lists: `registerToolDefinitions` appends definitions that live in other
// modules (`quick_script`, from `@nervekit/tools/quick-script`) before first use.
const coreDefinitions: ToolDefinition[] = [];
const allDefinitions: ToolDefinition[] = [];

export const coreToolDefinitions: readonly ToolDefinition[] = coreDefinitions;

export const orchestrationToolDefinitions: readonly ToolDefinition[] =
  Object.freeze(
    [
      ...processToolDefinitions,
      ...subagentToolDefinitions,
      ...planPresentToolDefinitions,
    ].map(withAgentResultPolicy),
  );

export const toolManifest: readonly ToolDefinition[] = allDefinitions;

function withAgentResultPolicy(definition: ToolDefinition): ToolDefinition {
  const agentResult =
    definition.agentResult ?? agentResultPolicyForTool(definition.name);
  if (!agentResult)
    throw new Error(`Missing agent result policy: ${definition.name}`);
  return Object.freeze({
    ...definition,
    traits: Object.freeze([...definition.traits]),
    agentResult: Object.freeze({ ...agentResult }),
  });
}

const definitionByName = new Map<ToolName, ToolDefinition>();

function addDefinition(definition: ToolDefinition): void {
  if (definitionByName.has(definition.name)) {
    throw new Error(`Duplicate tool definition: ${definition.name}`);
  }
  const permissionMetadata = permissionMetadataForTool(definition.name);
  if (
    !permissionMetadata.kind ||
    permissionMetadata.groups.length === 0 ||
    permissionMetadata.targetKinds.length === 0
  ) {
    throw new Error(`Incomplete permission metadata: ${definition.name}`);
  }
  if (!definition.group || !definition.baseRisk || !definition.executionKind) {
    throw new Error(`Incomplete tool metadata: ${definition.name}`);
  }
  if (definition.parameters.type !== "object") {
    throw new Error(
      `Tool parameters must use an object root: ${definition.name}`,
    );
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

for (const definition of [
  ...rawCoreToolDefinitions.map(withAgentResultPolicy),
]) {
  addDefinition(definition);
  coreDefinitions.push(definition);
  allDefinitions.push(definition);
}
for (const definition of orchestrationToolDefinitions) {
  addDefinition(definition);
  allDefinitions.push(definition);
}

/**
 * Adds core tool definitions owned by another package. The host calls this
 * once at startup, before any tool is listed or run; registering the same
 * definition again is a no-op.
 */
export function registerToolDefinitions(
  definitions: readonly ToolDefinition[],
): void {
  for (const definition of definitions) {
    const existing = definitionByName.get(definition.name);
    if (existing) {
      if (existing.label === definition.label) continue;
      throw new Error(`Duplicate tool definition: ${definition.name}`);
    }
    if (definition.permissionMetadata)
      registerExtensionToolMetadata(
        definition.name,
        definition.permissionMetadata,
      );
    const finalized = withAgentResultPolicy(definition);
    addDefinition(finalized);
    coreDefinitions.push(finalized);
    allDefinitions.push(finalized);
  }
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

export function localToolDefinitions(): readonly LocalToolDefinition[] {
  return toolManifest.filter(isLocalToolDefinition);
}

export function hostToolDefinitions(): readonly HostToolDefinition[] {
  return toolManifest.filter(isHostToolDefinition);
}

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
