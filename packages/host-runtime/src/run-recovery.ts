import type { RunRecord } from "@nervekit/contracts";
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
    state.run.status === "suspended" ||
    TERMINAL_STATUSES.has(state.run.status)
  ) {
    return { run: state.run, interrupted: false };
  }
  try {
    await assertCheckpoint(state, references, integrity);
    return {
      run: revise(
        state.run,
        {
          status: "interrupted",
          recoverability: "checkpoint",
          failure: {
            code: "RUN_INTERRUPTED",
            message: "Host restarted during active execution",
            retryable: true,
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
            message: "Run was interrupted without a valid durable checkpoint",
            retryable: true,
          },
        },
        terminalAt,
      ),
      transitionKind: "interrupted_without_checkpoint",
      interrupted: true,
    };
  }
}
