import type {
  ConversationActiveRunSnapshot,
  QueuedPromptRecord,
} from "$lib/api";

export interface AbortableConversationView {
  conversationId: string;
  sending: boolean;
  stopping: boolean;
  activeRun?: ConversationActiveRunSnapshot;
  queuedPrompts: QueuedPromptRecord[];
}

export interface AbortActiveRunDeps {
  agentId(): string | undefined;
  view(conversationId?: string): AbortableConversationView | undefined;
  cancelRun(agentId: string): Promise<void>;
  notifyError(title: string, options: { description: string }): void;
}

/**
 * Stop with an immediate, truthful "stopping" projection: the first click
 * synchronously moves the local active run to `aborting` and clears queued
 * prompts, duplicate clicks are suppressed, RPC failure restores the prior
 * projection, and RPC success applies a local terminal fallback while the
 * durable run.cancelled/run.failed events finish the canonical transition.
 */
export function createAbortActiveRun(
  deps: AbortActiveRunDeps,
): () => Promise<void> {
  const cancellationsInFlight = new Set<string>();
  return async function abortActiveRun(): Promise<void> {
    const agentId = deps.agentId();
    if (!agentId || cancellationsInFlight.has(agentId)) return;
    const view = deps.view();
    if (view?.activeRun?.status === "aborting") return;
    const conversationId = view?.conversationId;
    const targetRunId = view?.activeRun?.runId;
    const previous = view
      ? {
          activeRun: view.activeRun,
          queuedPrompts: view.queuedPrompts,
          sending: view.sending,
          stopping: view.stopping,
        }
      : undefined;
    if (view) {
      // The run is not terminal yet: keep the composer disabled via
      // `sending` and only project the truthful aborting status.
      if (view.activeRun) {
        view.activeRun = { ...view.activeRun, status: "aborting" };
      }
      view.stopping = true;
      view.queuedPrompts = [];
    }
    cancellationsInFlight.add(agentId);
    try {
      await deps.cancelRun(agentId);
    } catch (caught) {
      const current = conversationId ? deps.view(conversationId) : undefined;
      const targetStillProjected = Boolean(
        current?.stopping &&
        (targetRunId
          ? current.activeRun?.runId === targetRunId
          : !current.activeRun),
      );
      if (current && previous && targetStillProjected) {
        current.activeRun = previous.activeRun;
        current.queuedPrompts = previous.queuedPrompts;
        current.sending = previous.sending;
        current.stopping = previous.stopping;
      }
      // A durable terminal event can win even if the request transport later
      // rejects. Do not resurrect that run or report a false stop failure.
      const terminalEventWon = Boolean(
        current && targetRunId && !current.activeRun && !current.stopping,
      );
      if (
        current?.activeRun &&
        (!targetRunId || current.activeRun.runId !== targetRunId)
      ) {
        current.stopping = false;
      }
      if (!terminalEventWon) {
        deps.notifyError("Could not stop the run", {
          description:
            caught instanceof Error ? caught.message : String(caught),
        });
      }
      return;
    } finally {
      cancellationsInFlight.delete(agentId);
    }
    const current = conversationId ? deps.view(conversationId) : undefined;
    if (!current) return;
    const currentRunId = current.activeRun?.runId;
    const stillTarget = targetRunId
      ? !currentRunId || currentRunId === targetRunId
      : !currentRunId;
    if (!stillTarget) {
      current.stopping = false;
      return;
    }
    // Local terminal fallback from the acknowledgment; durable events remain
    // the canonical convergence mechanism.
    current.sending = false;
    current.stopping = false;
    current.activeRun = undefined;
    current.queuedPrompts = [];
  };
}
