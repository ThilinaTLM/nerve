import type {
  InteractionResolveResult,
  ProfileTransitionResult,
} from "@nervekit/contracts/agent-configuration";
import type {
  Interaction,
  InteractionKind,
  InteractionResolutionOf,
  ToolApprovalBinding,
  ToolCall,
} from "@nervekit/contracts/core";
import type { ToolExecutionResultPayload } from "@nervekit/contracts/tools";
import type { CoreToolContext, CoreToolHandler } from "./core-tool.js";
import type { ToolCallServiceOptions } from "./tool-call-types.js";

/** A rejected resolution (wrong kind, nothing to persist, already resolved). */
export class InteractionError extends Error {
  override readonly name = "InteractionError";
}

/** What a handler decided; `ToolCallInteractions` is the only place that acts on it. */
export type InteractionOutcome =
  | {
      kind: "settle";
      status: "completed" | "denied" | "cancelled" | "failed";
      result: ToolExecutionResultPayload;
    }
  /** Mark ready (with `patch`) and restart the worker. */
  | { kind: "retry"; patch: Partial<ToolCall> }
  /** Back to awaiting_input with a refreshed interaction (no recorded resolution). */
  | {
      kind: "reopen";
      interaction: Interaction;
      result: InteractionResolveResult;
    }
  /** Report a profile transition; settles the call only when it was applied. */
  | {
      kind: "transition";
      transition: ProfileTransitionResult;
      settle: ToolExecutionResultPayload;
    };

/** Result of re-entering an already-recorded resolution. */
export interface InteractionReconciliation {
  outcome: InteractionOutcome;
  /** Keep resolving the incoming request after applying `outcome`. */
  proceed: boolean;
}

/** What the service lends to handlers; nothing here is kind-specific. */
export interface InteractionContext {
  /** Aborts when the call is stopped (only for cancellable handlers). */
  readonly signal: AbortSignal;
  readonly resolutionRequestId: string;
  /** Transient approval binding presented to the user, captured before recording. */
  readonly presentedApproval: ToolApprovalBinding | undefined;
  readonly options: Pick<
    ToolCallServiceOptions,
    "permissions" | "context" | "coreTools"
  >;
  coreTool(name: string): CoreToolHandler | undefined;
  toolContext(call: ToolCall): CoreToolContext;
}

export interface InteractionHandler<K extends InteractionKind> {
  readonly kind: K;
  /** Registered with the call's controllers so stopping the call aborts `apply`. */
  readonly cancellable: boolean;
  /** Pure checks against the pending call. Throws `InteractionError`. */
  validate(call: ToolCall, resolution: InteractionResolutionOf<K>): void;
  /** Idempotent re-entry for an already-recorded resolution (plan approval after restart). */
  reconcile?(
    call: ToolCall,
    resolution: InteractionResolutionOf<K>,
    ctx: InteractionContext,
  ): Promise<InteractionReconciliation | undefined>;
  apply(
    call: ToolCall,
    resolution: InteractionResolutionOf<K>,
    ctx: InteractionContext,
  ): Promise<InteractionOutcome>;
  /**
   * Called when `apply` throws. Absent means the error propagates. A `reopen`
   * outcome is applied and the original error is still rethrown.
   */
  onError?(
    call: ToolCall,
    resolution: InteractionResolutionOf<K>,
    error: unknown,
    ctx: InteractionContext,
  ): Promise<InteractionOutcome | "rethrow">;
}

export type InteractionHandlers = {
  [K in InteractionKind]: InteractionHandler<K>;
};
