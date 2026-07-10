import {
  createToolDispatcher,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolHandlerRegistry,
} from "@nervekit/agent-tools";
import type { ToolName } from "@nervekit/contracts";

export type SandboxToolHostOptions = {
  toolName: ToolName;
  args: Record<string, unknown>;
  context: ToolExecutionContext;
  hostHandlers: ToolHandlerRegistry;
  identity?: unknown;
};

export async function executeSandboxTool(
  options: SandboxToolHostOptions,
): Promise<ToolExecutionResult> {
  const dispatcher = createToolDispatcher({
    advertisedToolNames: new Set<string>([options.toolName]),
    hostHandlers: options.hostHandlers,
    contextFor: () => options.context,
  });
  return dispatcher.execute(options.toolName, options.args, options.identity);
}
