import type { Static, TObject } from "typebox";
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
  ToolExecutionMode,
} from "./contracts/index.js";

export type AgentToolDefinitionLike<TParams extends TObject = TObject> = {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  normalizeArguments?: (args: unknown) => Static<TParams>;
  executionMode?: ToolExecutionMode;
};

export type AgentToolHostExecute = (
  definition: AgentToolDefinitionLike,
  sourceToolCallId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback,
) => Promise<AgentToolResult<unknown>>;

export type AgentToolAdapterOptions = {
  onOutputUpdate?: (
    toolName: string,
    sourceToolCallId: string,
    update: AgentToolResult<unknown>,
  ) => void;
};

/**
 * Mechanical adapter from transport-neutral tool definitions to harness tools.
 * Authorization, persistence, result conversion, and suspension remain owned by
 * the host callback.
 */
export function createAgentToolsFromDefinitions(
  definitions: readonly AgentToolDefinitionLike[],
  allowedNames: ReadonlySet<string> | undefined,
  execute: AgentToolHostExecute,
  options: AgentToolAdapterOptions = {},
): AgentTool[] {
  return definitions
    .filter((definition) => !allowedNames || allowedNames.has(definition.name))
    .map((definition) => ({
      name: definition.name,
      label: definition.label,
      description: definition.description,
      parameters: definition.parameters,
      normalizeArguments: definition.normalizeArguments,
      executionMode: definition.executionMode,
      execute: (sourceToolCallId, params, signal, onUpdate) =>
        execute(
          definition,
          sourceToolCallId,
          params as Record<string, unknown>,
          signal,
          (update) => {
            options.onOutputUpdate?.(definition.name, sourceToolCallId, update);
            onUpdate?.(update);
          },
        ),
    }));
}
