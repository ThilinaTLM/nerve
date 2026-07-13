import type { ConversationActiveRunSnapshot } from "@nervekit/contracts";
import { ACTIVE_STATUSES, type RunHydratedState } from "@nervekit/host-runtime";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { WorkbenchRunUnitOfWork } from "./run-transition.repository.js";

/** Canonical transition-backed workbench run projection for conversation UI. */
export class WorkbenchRunQuery {
  constructor(
    private readonly unitOfWork: WorkbenchRunUnitOfWork,
    private readonly state: RuntimeState,
  ) {}

  async states(): Promise<readonly RunHydratedState[]> {
    return this.unitOfWork.list();
  }

  async activeForConversation(
    conversationId: string,
  ): Promise<ConversationActiveRunSnapshot | undefined> {
    const canonical = (await this.states())
      .filter(
        (candidate) =>
          candidate.run.conversationId === conversationId &&
          ACTIVE_STATUSES.has(candidate.run.status),
      )
      .sort((a, b) => b.run.updatedAt.localeCompare(a.run.updatedAt))[0];
    if (!canonical) return undefined;
    const transient =
      this.state.conversationRuntime.snapshotForConversation(conversationId);
    return {
      runId: canonical.run.runId,
      agentId: canonical.run.agentId,
      projectId: canonical.run.projectId,
      conversationId: canonical.run.conversationId,
      status:
        canonical.run.status === "retrying" ||
        canonical.run.status === "interrupted" ||
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
      retry:
        canonical.run.status === "retrying"
          ? {
              attempt: canonical.run.attempt,
              maxRetries: Math.max(canonical.run.attempt, 3),
              delayMs: 0,
              retryAt: canonical.run.updatedAt,
              errorMessage: canonical.run.failure?.message,
            }
          : undefined,
    };
  }
}
