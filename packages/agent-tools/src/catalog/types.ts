import type {
  ToolExecutionKind,
  ToolGroupName,
  ToolName,
  ToolRisk,
  ToolTrait,
} from "@nervekit/contracts";
import type { Static, TSchema } from "typebox";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";

export type CoreToolExecutionMode = "sequential" | "parallel";
export type ToolArgumentRiskClassifier = (
  args: Record<string, unknown>,
) => ToolRisk;
export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolExecutionResult>;

interface ToolDefinitionBase<TParams extends TSchema = TSchema> {
  name: ToolName;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  prepareArguments?: (args: unknown) => Static<TParams>;
  executionMode?: CoreToolExecutionMode;
  group: ToolGroupName;
  baseRisk: ToolRisk;
  traits: readonly ToolTrait[];
  classifyRisk?: ToolArgumentRiskClassifier;
}

export interface LocalToolDefinition<TParams extends TSchema = TSchema>
  extends ToolDefinitionBase<TParams> {
  executionKind: "local";
  executor: ToolExecutor;
}

export interface HostToolDefinition<TParams extends TSchema = TSchema>
  extends ToolDefinitionBase<TParams> {
  executionKind: "host";
  executor?: never;
}

export type ToolDefinition<TParams extends TSchema = TSchema> =
  | LocalToolDefinition<TParams>
  | HostToolDefinition<TParams>;

/** @deprecated Use ToolDefinition. */
export type CoreToolDefinition<TParams extends TSchema = TSchema> =
  ToolDefinition<TParams>;

export function isLocalToolDefinition(
  definition: ToolDefinition,
): definition is LocalToolDefinition {
  return definition.executionKind === "local";
}

export function isHostToolDefinition(
  definition: ToolDefinition,
): definition is HostToolDefinition {
  return definition.executionKind === "host";
}

export function defineTool<const T extends ToolDefinition>(definition: T): T {
  return Object.freeze({
    ...definition,
    traits: Object.freeze([...definition.traits]),
  }) as unknown as T;
}

export type ToolDefinitionMetadata = {
  group: ToolGroupName;
  executionKind: ToolExecutionKind;
  baseRisk: ToolRisk;
  traits: readonly ToolTrait[];
};
