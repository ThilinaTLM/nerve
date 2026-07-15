import type {
  ConversationActiveRunSnapshot,
  QueuedPromptRecord,
} from "$lib/api";

export interface AbortableConversationView {
  sending: boolean;
  stopping: boolean;
  activeRun?: ConversationActiveRunSnapshot;
  queuedPrompts: QueuedPromptRecord[];
}

export interface AbortActiveRunDeps {
  agentId(): string | undefined;
  view(): AbortableConversationView | undefined;
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
      if (view && previous) {
        view.activeRun = previous.activeRun;
        view.queuedPrompts = previous.queuedPrompts;
        view.sending = previous.sending;
        view.stopping = previous.stopping;
      }
      deps.notifyError("Could not stop the run", {
        description: caught instanceof Error ? caught.message : String(caught),
      });
      return;
    } finally {
      cancellationsInFlight.delete(agentId);
    }
    if (view) {
      // Local terminal fallback from the acknowledgment; durable events
      // remain the canonical convergence mechanism.
      view.sending = false;
      view.stopping = false;
      view.activeRun = undefined;
      view.queuedPrompts = [];
    }
  };
}
