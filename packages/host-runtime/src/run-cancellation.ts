import type { RunRecord } from "@nervekit/contracts";
import type { RunCancellationPort, RunExecution } from "./run-execution.js";
import { revise, type TransitionChanges } from "./run-transitions.js";
import type { RunHydratedState } from "./run-unit-of-work.js";

export const CANCELLATION_TARGETS = [
  "model",
  "tool",
  "task",
  "subagent",
  "interaction",
] as const;

export function requestCancellation(
  state: RunHydratedState,
  now: string,
): { run: RunRecord; changes: TransitionChanges } {
  const run = revise(
    state.run,
    {
      status: "cancellation_requested",
      cancellationEvidence: CANCELLATION_TARGETS.map((target) => ({
        target,
        status: "pending",
        checkedAt: now,
      })),
    },
    now,
  );
  return {
    run,
    changes: {
      prompts: state.prompts
        .filter((item) => ["queued", "accepted"].includes(item.status))
        .map((item) => ({
          ...item,
          status: "cancelled" as const,
          updatedAt: now,
        })),
      interactions: state.interactions
        .filter((item) => item.status === "pending")
        .map((item) => ({
          ...item,
          status: "cancelled" as const,
          resolvedAt: now,
        })),
    },
  };
}

export async function cancelRunTarget(
  target: RunRecord["cancellationEvidence"][number]["target"],
  run: RunRecord,
  cancellation: RunCancellationPort,
  execution?: RunExecution,
  reason?: string,
): Promise<"confirmed" | "not_running"> {
  if (target === "model") {
    if (execution) await execution.control.cancel(reason);
    return cancellation.cancelModel(run);
  }
  if (target === "tool") return cancellation.cancelTools(run);
  if (target === "task") return cancellation.cancelTasks(run);
  if (target === "subagent") return cancellation.cancelSubagents(run);
  return cancellation.cancelInteraction(run);
}

export function finishCancellation(
  run: RunRecord,
  evidence: RunRecord["cancellationEvidence"],
  now: string,
): { run: RunRecord; failed: boolean } {
  const failed = evidence.some((item) => item.status === "failed");
  return {
    failed,
    run: revise(
      run,
      {
        status: failed ? "cancellation_failed" : "cancelled",
        recoverability: failed ? "manual" : "none",
        cancellationEvidence: evidence,
        terminalAt: failed ? undefined : now,
        failure: failed
          ? {
              code: "CANCELLATION_UNCONFIRMED",
              message: "One or more cancellation targets remain unconfirmed",
              retryable: true,
            }
          : undefined,
      },
      now,
    ),
  };
}
