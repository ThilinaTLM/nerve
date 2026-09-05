import type {
  ConversationActiveRunSnapshot,
  ConversationRunRetrySnapshot,
} from "@nervekit/contracts/conversations";
import { ACTIVE_STATUSES, type RunHydratedState } from "../runtime/index.js";
import type { RuntimeState } from "../../../app/runtime/runtime-projections.js";
import type { WorkbenchRunUnitOfWork } from "../persistence/run-transition.repository.js";

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
    activeEntryIds?: readonly string[],
  ): Promise<ConversationActiveRunSnapshot | undefined> {
    const canonical = (await this.unitOfWork.listActive())
      .filter(
        (candidate) =>
          candidate.run.conversationId === conversationId &&
          ACTIVE_STATUSES.has(candidate.run.status),
      )
      .sort((a, b) => b.run.updatedAt.localeCompare(a.run.updatedAt))[0];
    if (!canonical) return undefined;
    const branchAnchor = canonical.checkpoints.find(
      (checkpoint) =>
        checkpoint.checkpointId === canonical.run.lastCheckpointId,
    )?.harnessLeafId;
    const settlement = await this.unitOfWork.approvalSettlementForRun(
      canonical.run.runId,
    );
    const outsideBranch = Boolean(
      activeEntryIds && branchAnchor && !activeEntryIds.includes(branchAnchor),
    );
    // A blocked settlement still owns the busy run. Keep its cancellation
    // guidance visible even when the user selected a different branch.
    if (outsideBranch && settlement?.phase !== "blocked") return undefined;
    const transient =
      this.state.conversationRuntime.snapshotForConversation(conversationId);
    const retry = retrySnapshot(canonical);
    return {
      runId: canonical.run.runId,
      agentId: canonical.run.agentId,
      projectId: canonical.run.projectId,
      conversationId: canonical.run.conversationId,
      settlement,
      status: retry
        ? "retrying"
        : canonical.run.status === "settling"
          ? "settling"
          : canonical.run.status === "waiting"
            ? "waiting"
            : canonical.run.status === "interrupted"
              ? "interrupted"
              : canonical.run.status === "cancellation_failed"
                ? "retrying"
                : canonical.run.status === "cancellation_requested"
                  ? "aborting"
                  : "running",
      startedAt: canonical.run.startedAt ?? canonical.run.createdAt,
      turns: outsideBranch ? [] : (transient?.turns ?? []),
      toolOutputsByToolCallId: outsideBranch
        ? {}
        : (transient?.toolOutputsByToolCallId ?? {}),
      queuedPrompts: canonical.prompts.filter(
        (prompt) => prompt.status === "queued" || prompt.status === "accepted",
      ),
      retry,
      recovery:
        canonical.run.status === "interrupted"
          ? {
              errorMessage: canonical.run.failure?.message,
              continuable: canonical.run.recoverability === "checkpoint",
            }
          : undefined,
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
