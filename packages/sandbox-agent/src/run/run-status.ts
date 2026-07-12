import type { SandboxRunStatus } from "@nervekit/contracts";

/**
 * Maps the canonical RunCoordinator status to the public SandboxRunStatus used
 * by daemon operations, summaries, and snapshots.
 */
export function mapRunStatusToSandbox(status: string): SandboxRunStatus {
  switch (status) {
    case "starting":
      return "queued";
    case "running":
    case "cancellation_requested":
    case "suspended":
      return "running";
    case "waiting":
      return "waiting_for_input";
    case "retrying":
    case "interrupted":
    case "cancellation_failed":
      return "recoverable_failed";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}
