import type {
  TimelinePage,
  TimelineViewOutcome,
} from "@nervekit/contracts/conversations";

export type TimelineReconciliationAction =
  | { kind: "apply_page"; page: TimelinePage }
  | {
      kind: "preserve_and_retry";
      reason: "projection_lag" | "rebuilding";
      retryAfterRevision: number;
    }
  | {
      kind: "discard_cursor_and_reload";
      reason:
        | "incompatible_view"
        | "expired_cursor"
        | "restore_invalidated"
        | "reconciliation_required";
    }
  | { kind: "clear_and_close"; ownerId: string }
  | { kind: "clear_protected_rows"; reason: string };

/**
 * Exhaustive client policy for canonical fixed-view outcomes. Event delivery may
 * invalidate a query, but only a `page` outcome may add timeline rows.
 */
export function reconcileTimelineOutcome(
  outcome: TimelineViewOutcome,
): TimelineReconciliationAction {
  switch (outcome.kind) {
    case "page":
      return { kind: "apply_page", page: outcome.page };
    case "projection_lag":
      return {
        kind: "preserve_and_retry",
        reason: "projection_lag",
        retryAfterRevision: outcome.requestedRevision,
      };
    case "rebuilding":
      return {
        kind: "preserve_and_retry",
        reason: "rebuilding",
        retryAfterRevision: outcome.appliedRevision,
      };
    case "incompatible_view":
    case "expired_cursor":
    case "restore_invalidated":
    case "reconciliation_required":
      return { kind: "discard_cursor_and_reload", reason: outcome.kind };
    case "deleted_owner":
      return { kind: "clear_and_close", ownerId: outcome.ownerId };
    case "access_denied":
      return { kind: "clear_protected_rows", reason: outcome.reason };
    default:
      return assertNever(outcome);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled timeline outcome: ${JSON.stringify(value)}`);
}
