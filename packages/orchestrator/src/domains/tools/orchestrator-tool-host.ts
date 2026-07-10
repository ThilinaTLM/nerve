import {
  createToolDispatcher,
  hostToolDefinitions,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolHandlerRegistry,
} from "@nervekit/agent-tools";
import type { ToolCallRecord, ToolName } from "@nervekit/contracts";
import type { ToolRequestOptions } from "./tool-service.js";

export type OrchestratorToolHostPort = {
  executionContext(
    toolCall: ToolCallRecord,
    options: ToolRequestOptions,
  ): Promise<ToolExecutionContext> | ToolExecutionContext;
  executeHostTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: ToolRequestOptions,
  ): Promise<unknown>;
  executeLocalOverride(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: ToolRequestOptions,
    context: ToolExecutionContext,
  ): Promise<unknown>;
};

export function createOrchestratorToolHost(
  port: OrchestratorToolHostPort,
  toolCall: ToolCallRecord,
  options: ToolRequestOptions,
) {
  const hostHandlers: ToolHandlerRegistry = {};
  for (const definition of hostToolDefinitions) {
    hostHandlers[definition.name] = async (args) =>
      (await port.executeHostTool(
        { ...toolCall, toolName: definition.name },
        args,
        options,
      )) as ToolExecutionResult;
  }
  const localOverride = async (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ) =>
    (await port.executeLocalOverride(
      toolCall,
      args,
      options,
      context,
    )) as ToolExecutionResult;

  return createToolDispatcher({
    advertisedToolNames: new Set<string>([toolCall.toolName]),
    hostHandlers,
    localOverrides: {
      bash: localOverride,
      python: localOverride,
    },
    contextFor: () => port.executionContext(toolCall, options),
  });
}

export async function executeOrchestratorTool(
  port: OrchestratorToolHostPort,
  toolCall: ToolCallRecord,
  args: Record<string, unknown>,
  options: ToolRequestOptions,
): Promise<ToolExecutionResult> {
  const host = createOrchestratorToolHost(port, toolCall, options);
  return host.execute(toolCall.toolName as ToolName, args, {
    toolCallId: toolCall.id,
    providerToolCallId: toolCall.providerToolCallId,
  });
}
