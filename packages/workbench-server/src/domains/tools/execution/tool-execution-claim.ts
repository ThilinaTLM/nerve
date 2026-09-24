import type { ToolCallRecord } from "@nervekit/contracts/tools";

export type PreDispatchFailureReason =
  | "not_approved"
  | "stale_context"
  | "policy_changed";

/**
 * A definite failure before the durable dispatch boundary. No external tool
 * invocation has started, so callers may record an actionable failure rather
 * than an unknown outcome.
 */
export class PreDispatchError extends Error {
  constructor(
    readonly reason: PreDispatchFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "PreDispatchError";
  }
}

/** The tool already crossed its dispatch boundary, or is terminal. */
export class ToolExecutionAlreadyClaimedError extends Error {
  constructor(readonly toolCall: ToolCallRecord) {
    super(`Tool call ${toolCall.id} is already ${toolCall.status}.`);
    this.name = "ToolExecutionAlreadyClaimedError";
  }
}

export function isPreDispatchError(error: unknown): error is PreDispatchError {
  return error instanceof PreDispatchError;
}
