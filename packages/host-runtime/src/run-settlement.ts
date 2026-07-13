import type { RunRecord } from "@nervekit/contracts";
import { InvalidRunStateError } from "./run-errors.js";
import type { RunEventFactory } from "./run-events.js";
import {
  executionRecord,
  revise,
  TERMINAL_STATUSES,
  type TransitionChanges,
} from "./run-transitions.js";
import type { RunHydratedState } from "./run-unit-of-work.js";

export interface RunSettlement {
  run: RunRecord;
  changes: TransitionChanges;
}

export function completeExecution(
  state: RunHydratedState,
  executionId: string,
  result: Readonly<Record<string, unknown>>,
  now: string,
  events: RunEventFactory,
): RunSettlement | undefined {
  if (
    TERMINAL_STATUSES.has(state.run.status) ||
    state.run.executionId !== executionId ||
    state.run.status === "cancellation_requested"
  ) {
    return undefined;
  }
  return completed(state.run, result, now, events);
}

export function completeResolvedInteraction(
  state: RunHydratedState,
  interactionId: string,
  result: Readonly<Record<string, unknown>>,
  now: string,
  events: RunEventFactory,
): RunSettlement {
  const interaction = state.interactions.find(
    (candidate) => candidate.id === interactionId,
  );
  if (
    state.run.status !== "suspended" ||
    state.run.activeInteractionId !== interactionId ||
    interaction?.status !== "resolved"
  ) {
    throw new InvalidRunStateError(
      "Only a resolved suspended interaction can complete its run",
    );
  }
  return completed(state.run, { ...result }, now, events, {
    activeInteractionId: undefined,
  });
}

function completed(
  run: RunRecord,
  result: Readonly<Record<string, unknown>>,
  now: string,
  events: RunEventFactory,
  patch: Partial<RunRecord> = {},
): RunSettlement {
  const next = revise(
    run,
    {
      ...patch,
      status: "completed",
      recoverability: "not_needed",
      result: { ...result },
      terminalAt: now,
    },
    now,
  );
  return {
    run: next,
    changes: {
      execution: executionRecord(next, "completed", now),
      events: [events.completed(next, now)],
    },
  };
}
