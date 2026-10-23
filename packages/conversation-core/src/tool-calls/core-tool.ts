import type { ProfileTransitionResult } from "@nervekit/contracts/agent-configuration";
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
  ): Promise<CoreToolResolution>;
  recover?(call: ToolCall, ctx: CoreToolContext): Promise<CoreToolResolution>;
}
export type CoreToolResolution =
  | ToolExecutionResultPayload
  | (ToolExecutionResultPayload & {
      kind: "profile_transition";
      transition: ProfileTransitionResult;
      result: ToolExecutionResultPayload;
    });
export type CoreToolOutcome =
  | { kind: "completed"; result: ToolExecutionResultPayload }
  | { kind: "awaiting_input"; interaction: Interaction };
export interface CoreToolContext {
  conversationId: string;
  /** Process-local advertised configuration; absent after restart requires recapture. */
  requestCaptureId?: string;
  signal: AbortSignal;
  onProgress(update: ToolProgress): void;
}
