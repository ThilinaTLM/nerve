import type {
  ToolExecutionKind,
  ToolGroupName,
  ToolName,
  ToolRisk,
  ToolTrait,
} from "@nervekit/contracts";
import type { Static, TObject } from "typebox";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";

export type CoreToolExecutionMode = "sequential" | "parallel";
export type ToolArgumentRiskClassifier = (
  args: Record<string, unknown>,
) => ToolRisk;
export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolExecutionResult>;

interface ToolDefinitionBase<TParams extends TObject = TObject> {
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

export interface LocalToolDefinition<
  TParams extends TObject = TObject,
> extends ToolDefinitionBase<TParams> {
  executionKind: "local";
  executor: ToolExecutor;
}

export interface HostToolDefinition<
  TParams extends TObject = TObject,
> extends ToolDefinitionBase<TParams> {
  executionKind: "host";
  executor?: never;
}

export type ToolDefinition<TParams extends TObject = TObject> =
  | LocalToolDefinition<TParams>
  | HostToolDefinition<TParams>;

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
