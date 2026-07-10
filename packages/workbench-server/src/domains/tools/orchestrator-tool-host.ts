import {
  createToolDispatcher,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolHandlerRegistry,
} from "@nervekit/host-runtime/tools";
import type { ToolCallRecord, ToolName } from "@nervekit/contracts";
import type { ToolRequestOptions } from "./tool-service.js";

export type OrchestratorToolHostPort = {
  executionContext(
    toolCall: ToolCallRecord,
    options: ToolRequestOptions,
  ): Promise<ToolExecutionContext> | ToolExecutionContext;
  hostHandlers(
    toolCall: ToolCallRecord,
    options: ToolRequestOptions,
  ): ToolHandlerRegistry;
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
  const hostHandlers = port.hostHandlers(toolCall, options);
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
  return host.execute(toolCall.toolName as ToolName, args, toolCall);
}
