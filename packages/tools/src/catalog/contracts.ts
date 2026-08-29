import type {
  ToolExecutionKind,
  ToolGroupName,
  ToolName,
  ToolRisk,
  ToolTrait,
} from "@nervekit/contracts";
import type { Static, TObject } from "typebox";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../execution/execution-context.js";
import type { AgentResultPolicy } from "../result-projection/types.js";

export type CoreToolExecutionMode = "sequential" | "parallel";
export type ToolArgumentRiskClassifier = (
  args: Record<string, unknown>,
) => ToolRisk;
export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolExecutionResult>;

export type ToolPermissionTargetDescriptor =
  | {
      kind: "path";
      access: "read" | "write";
      scope: "exact" | "tree";
      arguments: readonly string[];
      defaultValue?: string;
    }
  | { kind: "web_host"; argument: string }
  | { kind: "command_segments"; argument: string };

interface ToolDefinitionBase<TParams extends TObject = TObject> {
  name: ToolName;
  label: string;
  description: string;
  parameters: TParams;
  normalizeArguments?: (args: unknown) => Static<TParams>;
  executionMode?: CoreToolExecutionMode;
  group: ToolGroupName;
  baseRisk: ToolRisk;
  traits: readonly ToolTrait[];
  classifyRisk?: ToolArgumentRiskClassifier;
  permission?: {
    durableAllow: "never" | "tool" | "target";
    targets?: readonly ToolPermissionTargetDescriptor[];
  };
  /** Host/model-only semantic result projection policy; never exposed publicly. */
  agentResult?: AgentResultPolicy;
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
    ...(definition.agentResult
      ? { agentResult: Object.freeze({ ...definition.agentResult }) }
      : {}),
  }) as unknown as T;
}

export type ToolDefinitionMetadata = {
  group: ToolGroupName;
  executionKind: ToolExecutionKind;
  baseRisk: ToolRisk;
  traits: readonly ToolTrait[];
};
