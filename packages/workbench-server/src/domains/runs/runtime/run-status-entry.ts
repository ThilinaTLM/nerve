import type {
  ConversationEntry,
  ConversationRunStatusDetails,
} from "@nervekit/contracts/conversations";
import { normalizeRunFailure, type RunRecord } from "@nervekit/contracts/runs";
import type { RunHydratedState } from "./run-unit-of-work.js";

export type DurableRunStatusState = Exclude<
  ConversationRunStatusDetails["state"],
  "retrying"
>;

/** Builds the single UI projection owned by a terminal/interruption transition. */
export function buildRunStatusEntry(input: {
  previous: RunHydratedState;
  run: RunRecord;
  state: DurableRunStatusState;
}): ConversationEntry {
  const { previous, run, state } = input;
  const failedEntryId = latestFailedAssistantEntryId(previous);
  const parentEntryId = latestTranscriptEntryId(previous);
  const normalized = normalizeRunFailure(run.failure?.message);
  const continuable =
    run.status === "interrupted" && run.recoverability === "checkpoint";
  const details: ConversationRunStatusDetails = {
    type: "agent_run_retry_status",
    state,
    runId: run.runId,
    ...(failedEntryId ? { failedEntryId } : {}),
    attempt: run.attempt,
    errorMessage: normalized.message,
    failureCategory: run.failure?.category ?? normalized.category,
    ...((run.failure?.httpStatus ?? normalized.httpStatus)
      ? { httpStatus: run.failure?.httpStatus ?? normalized.httpStatus }
      : {}),
    retryable: continuable,
  };
  return {
    id: `entry_run_status_${run.runId.slice(4)}_${run.revision}_${state}`,
    conversationId: run.conversationId,
    agentId: run.agentId,
    runId: run.runId,
    ...(parentEntryId ? { parentEntryId } : {}),
    role: "system",
    kind: "run_status",
    text: normalized.message,
    details,
    createdAt: run.updatedAt,
  };
}

function latestTranscriptEntryId(state: RunHydratedState): string | undefined {
  for (
    let transitionIndex = state.transitions.length - 1;
    transitionIndex >= 0;
    transitionIndex -= 1
  ) {
    const entry = state.transitions[transitionIndex]?.entries.at(-1);
    if (entry) return entry.id;
  }
  return undefined;
}

function latestFailedAssistantEntryId(
  state: RunHydratedState,
): string | undefined {
  for (
    let transitionIndex = state.transitions.length - 1;
    transitionIndex >= 0;
    transitionIndex -= 1
  ) {
    const entries = state.transitions[transitionIndex]?.entries ?? [];
    for (
      let entryIndex = entries.length - 1;
      entryIndex >= 0;
      entryIndex -= 1
    ) {
      const entry = entries[entryIndex];
      if (
        entry?.role === "assistant" &&
        asRecord(entry.details)?.stopReason === "error"
      ) {
        return entry.id;
      }
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
