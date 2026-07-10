import {
  createToolDispatcher,
  hostToolDefinitions,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolHandlerRegistry,
} from "@nervekit/agent-tools";
import type { ToolName } from "@nervekit/contracts";
import type { OrchestrationToolRunner } from "./orchestration-tool-runner.js";

export type SandboxToolHostOptions = {
  toolName: ToolName;
  args: Record<string, unknown>;
  context: ToolExecutionContext;
  orchestrationRunner: OrchestrationToolRunner;
  identity?: unknown;
  tracking?: {
    toolCallId: string;
    setCancel?: (cancel: () => Promise<void> | void) => void;
  };
};

export async function executeSandboxTool(
  options: SandboxToolHostOptions,
): Promise<ToolExecutionResult> {
  const hostHandlers: ToolHandlerRegistry = {};
  for (const definition of hostToolDefinitions) {
    hostHandlers[definition.name] = (args, context) => {
      if (!options.tracking) {
        throw new Error(
          `Host tool '${definition.name}' requires tracking context.`,
        );
      }
      return options.orchestrationRunner.execute(
        definition.name,
        args,
        context,
        options.tracking,
      );
    };
  }
  const dispatcher = createToolDispatcher({
    advertisedToolNames: new Set<string>([options.toolName]),
    hostHandlers,
    contextFor: () => options.context,
  });
  return dispatcher.execute(options.toolName, options.args, options.identity);
}
