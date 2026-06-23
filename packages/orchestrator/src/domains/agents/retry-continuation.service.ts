import type { ConversationEntry } from "@nerve/shared";
import { HttpError } from "../../http/errors.js";
import type { RuntimeState } from "../../runtime/runtime-state.js";

export interface RetryContinuationServiceDeps {
  state: RuntimeState;
  getConversationEntries(conversationId: string): ConversationEntry[];
  continueFromFailedTurn(agentId: string, failedEntryId: string): Promise<void>;
}

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
      details.state !== "retry_exhausted" ||
      details.retryable !== true ||
      !details.failedEntryId
    ) {
      throw new HttpError(
        400,
        "INVALID_RETRY_STATUS",
        "Entry is not a retry-exhausted status entry.",
      );
    }
    const failedEntry = entries.find(
      (entry) => entry.id === details.failedEntryId,
    );
    const failedDetails = runFailureDetails(failedEntry?.details);
    if (
      failedEntry?.role !== "assistant" ||
      failedDetails?.stopReason !== "error" ||
      !failedDetails.errorMessage
    ) {
      throw new HttpError(
        400,
        "INVALID_FAILED_ENTRY",
        "Retry status does not reference a valid failed assistant entry.",
      );
    }
    await this.deps.continueFromFailedTurn(agent.id, details.failedEntryId);
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
