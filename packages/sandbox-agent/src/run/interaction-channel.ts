interface PendingInteraction {
  runId: string;
  resolve: (resolution: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

export class InteractionCancelledError extends Error {
  readonly code = "INTERACTION_CANCELLED";
}

/**
 * Live, in-memory resolution channel owned by the execution layer. A tool
 * handler that enters a durable wait registers the interaction id here and
 * awaits it; the coordinator's resolveInteraction wakes exactly one pending
 * tool via `deliver`. After a restart the channel is empty, so the run stays
 * durably suspended and only a checkpoint-based continue resumes it — no
 * promise is ever falsely reconstructed.
 */
export class SandboxInteractionChannel {
  private readonly pending = new Map<string, PendingInteraction>();

  register(
    runId: string,
    interactionId: string,
  ): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(interactionId, { runId, resolve, reject });
    });
  }

  deliver(interactionId: string, resolution: Record<string, unknown>): boolean {
    const entry = this.pending.get(interactionId);
    if (!entry) return false;
    this.pending.delete(interactionId);
    entry.resolve(resolution);
    return true;
  }

  hasPendingForRun(runId: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.runId === runId) return true;
    }
    return false;
  }

  cancelRun(runId: string, reason = "run cancelled"): number {
    let cancelled = 0;
    for (const [interactionId, entry] of [...this.pending.entries()]) {
      if (entry.runId !== runId) continue;
      this.pending.delete(interactionId);
      entry.reject(new InteractionCancelledError(reason));
      cancelled += 1;
    }
    return cancelled;
  }
}
