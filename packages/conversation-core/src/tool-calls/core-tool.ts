import type {
  Interaction,
  InteractionResolution,
  ToolCall,
  ToolProgress,
} from "@nervekit/contracts/core";
import type { ToolExecutionResultPayload } from "@nervekit/contracts/tools";
import type { ToolDefinition } from "@nervekit/tools/catalog";

export interface CoreToolHandler {
  definition: ToolDefinition;
  execute(call: ToolCall, ctx: CoreToolContext): Promise<CoreToolOutcome>;
  resolve?(
    call: ToolCall,
    resolution: InteractionResolution,
    ctx: CoreToolContext,
  ): Promise<ToolExecutionResultPayload>;
}
export type CoreToolOutcome =
  | { kind: "completed"; result: ToolExecutionResultPayload }
  | { kind: "awaiting_input"; interaction: Interaction };
export interface CoreToolContext {
  conversationId: string;
  signal: AbortSignal;
  onProgress(update: ToolProgress): void;
}
