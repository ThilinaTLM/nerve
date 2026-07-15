import type {
  ConversationActiveRunSnapshot,
  ConversationRunRetrySnapshot,
} from "@nervekit/contracts";
import { ACTIVE_STATUSES, type RunHydratedState } from "@nervekit/host-runtime";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { WorkbenchRunUnitOfWork } from "./run-transition.repository.js";

/** Canonical transition-backed workbench run projection for conversation UI. */
export class WorkbenchRunQuery {
  constructor(
    private readonly unitOfWork: WorkbenchRunUnitOfWork,
    private readonly state: RuntimeState,
  ) {}

  /** Full historical projection; reserved for explicit history queries. */
  async states(): Promise<readonly RunHydratedState[]> {
    return this.unitOfWork.list();
  }

  async activeForConversation(
    conversationId: string,
  ): Promise<ConversationActiveRunSnapshot | undefined> {
    const canonical = (await this.unitOfWork.listActive())
      .filter(
        (candidate) =>
          candidate.run.conversationId === conversationId &&
          ACTIVE_STATUSES.has(candidate.run.status),
      )
      .sort((a, b) => b.run.updatedAt.localeCompare(a.run.updatedAt))[0];
    if (!canonical) return undefined;
    const transient =
      this.state.conversationRuntime.snapshotForConversation(conversationId);
    const retry = retrySnapshot(canonical);
    return {
      runId: canonical.run.runId,
      agentId: canonical.run.agentId,
      projectId: canonical.run.projectId,
      conversationId: canonical.run.conversationId,
      status: retry
        ? "retrying"
        : canonical.run.status === "interrupted" ||
            canonical.run.status === "cancellation_failed"
          ? "retrying"
          : canonical.run.status === "cancellation_requested"
            ? "aborting"
            : "running",
      startedAt: canonical.run.startedAt ?? canonical.run.createdAt,
      turns: transient?.turns ?? [],
      toolOutputsByToolCallId: transient?.toolOutputsByToolCallId ?? {},
      queuedPrompts: canonical.prompts.filter(
        (prompt) => prompt.status === "queued" || prompt.status === "accepted",
      ),
      retry,
    };
  }
}

function retrySnapshot(
  state: RunHydratedState,
): ConversationRunRetrySnapshot | undefined {
  if (state.run.status !== "retrying" || !state.run.failure) return undefined;
  const events = state.transitions.flatMap((transition) => transition.events);
  let event: (typeof events)[number] | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === "run.retrying") {
      event = events[index];
      break;
    }
  }
  if (!event || !event.data || typeof event.data !== "object") return undefined;
  const data = event.data as Record<string, unknown>;
  if (
    typeof data.attempt !== "number" ||
    typeof data.maxRetries !== "number" ||
    typeof data.delayMs !== "number" ||
    typeof data.retryAt !== "string"
  ) {
    return undefined;
  }
  return {
    attempt: data.attempt,
    maxRetries: data.maxRetries,
    delayMs: data.delayMs,
    retryAt: data.retryAt,
    errorMessage:
      typeof data.errorMessage === "string"
        ? data.errorMessage
        : state.run.failure.message,
    failedEntryId:
      typeof data.failedEntryId === "string" ? data.failedEntryId : undefined,
  };
}
