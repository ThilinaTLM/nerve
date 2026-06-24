import type { ConversationEntry } from "@nerve/shared";
import { HttpError } from "../../http/errors.js";
import type { RuntimeState } from "../../runtime/runtime-state.js";

export interface RetryContinuationServiceDeps {
  state: RuntimeState;
  getConversationEntries(conversationId: string): ConversationEntry[];
  continueFromFailedTurn(agentId: string, failedEntryId: string): Promise<void>;
  resumeRun(agentId: string): Promise<void>;
}

const CONTINUABLE_STATES = new Set([
  "retry_exhausted",
  "failed",
  "interrupted",
]);

export class RetryContinuationService {
  constructor(private readonly deps: RetryContinuationServiceDeps) {}

  async continueFromFailedTurn(
    agentId: string,
    statusEntryId: string,
  ): Promise<void> {
    const agent = this.deps.state.getAgent(agentId);
    if (this.deps.state.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }
    const entries = this.deps.getConversationEntries(agent.conversationId);
    const statusEntry = entries.at(-1);
    if (!statusEntry || statusEntry.id !== statusEntryId) {
      throw new HttpError(
        400,
        "RETRY_STATUS_NOT_AT_BRANCH_TAIL",
        "Retry status is no longer at the end of the active conversation branch.",
      );
    }
    const details = runStatusDetails(statusEntry.details);
    if (
      statusEntry.role !== "system" ||
      statusEntry.kind !== "run_status" ||
      details?.type !== "agent_run_retry_status" ||
      typeof details.state !== "string" ||
      !CONTINUABLE_STATES.has(details.state) ||
      details.retryable !== true
    ) {
      throw new HttpError(
        400,
        "INVALID_RUN_STATUS",
        "Entry is not a continuable run-status entry.",
      );
    }
    // When the status references a re-runnable failed model turn, rewind to its
    // parent and re-run that turn. Otherwise (interruption or a loop exception with
    // no failed model turn) resume forward from the current conversation leaf.
    const failedEntry = details.failedEntryId
      ? entries.find((entry) => entry.id === details.failedEntryId)
      : undefined;
    const failedDetails = runFailureDetails(failedEntry?.details);
    const isReRunnableFailedTurn =
      failedEntry?.role === "assistant" &&
      failedDetails?.stopReason === "error" &&
      Boolean(failedDetails.errorMessage);
    if (failedEntry && isReRunnableFailedTurn) {
      await this.deps.continueFromFailedTurn(agent.id, failedEntry.id);
      return;
    }
    await this.deps.resumeRun(agent.id);
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function runStatusDetails(value: unknown):
  | {
      type?: unknown;
      state?: unknown;
      retryable?: unknown;
      failedEntryId?: string;
    }
  | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  return {
    type: record.type,
    state: record.state,
    retryable: record.retryable,
    failedEntryId:
      typeof record.failedEntryId === "string"
        ? record.failedEntryId
        : undefined,
  };
}

function runFailureDetails(
  value: unknown,
): { stopReason?: unknown; errorMessage?: string } | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  return {
    stopReason: record.stopReason,
    errorMessage:
      typeof record.errorMessage === "string" ? record.errorMessage : undefined,
  };
}
