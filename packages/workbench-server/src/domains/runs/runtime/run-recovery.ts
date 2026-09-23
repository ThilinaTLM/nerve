import { normalizeRunFailure, type RunRecord } from "@nervekit/contracts/runs";
import { assertCheckpoint } from "./run-checkpoints.js";
import type { RunIntegrityPort } from "./run-execution.js";
import { revise, TERMINAL_STATUSES } from "./run-transitions.js";
import type {
  RunCheckpointReferencePort,
  RunHydratedState,
} from "./run-unit-of-work.js";

export interface RunRecoveryDecision {
  run: RunRecord;
  transitionKind?: "interrupted" | "interrupted_without_checkpoint";
  interrupted: boolean;
}

export async function decideRunRecovery(
  state: RunHydratedState,
  references: RunCheckpointReferencePort,
  integrity: RunIntegrityPort,
  now: () => string,
): Promise<RunRecoveryDecision> {
  if (
    state.run.status === "waiting" ||
    // Durable execute_tool work, not a live model turn, owns this progress.
    state.run.status === "executing_tools" ||
    state.run.status === "suspended" ||
    TERMINAL_STATUSES.has(state.run.status)
  ) {
    return { run: state.run, interrupted: false };
  }
  try {
    await assertCheckpoint(state, references, integrity);
    if (state.run.status === "interrupted") {
      return { run: state.run, interrupted: false };
    }
    return {
      run: revise(
        state.run,
        {
          status: "interrupted",
          recoverability: "checkpoint",
          failure: {
            code: "RUN_INTERRUPTED",
            ...normalizeRunFailure(
              "Host restarted during active execution",
              "harness",
            ),
            retryable: true,
            continuable: true,
          },
        },
        now(),
      ),
      transitionKind: "interrupted",
      interrupted: true,
    };
  } catch {
    const terminalAt = now();
    return {
      run: revise(
        state.run,
        {
          status: "failed",
          recoverability: "none",
          terminalAt,
          failure: {
            code: "INVALID_CHECKPOINT",
            ...normalizeRunFailure(
              "Run was interrupted without a valid durable checkpoint",
              "harness",
            ),
            retryable: true,
            continuable: false,
          },
        },
        terminalAt,
      ),
      transitionKind: "interrupted_without_checkpoint",
      interrupted: true,
    };
  }
}
