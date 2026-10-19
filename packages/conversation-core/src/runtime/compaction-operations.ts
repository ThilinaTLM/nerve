import { createId } from "@nervekit/contracts";
import type { CompactionOperation } from "@nervekit/contracts/core";
import type { CoreEmitter } from "./core-change.js";

/** Runtime-only authority. Drafts and terminal failures intentionally do not survive restart. */
export class CompactionOperations {
  private readonly operations = new Map<string, CompactionOperation>();
  private readonly positions = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly emit: CoreEmitter,
    private readonly now: () => string,
  ) {}

  get(conversationId: string): CompactionOperation | null {
    const operation = this.operations.get(conversationId);
    return operation ? structuredClone(operation) : null;
  }

  assertIdle(conversationId: string): void {
    const status = this.operations.get(conversationId)?.status;
    if (status === "running" || status === "stopping")
      throw new Error("Conversation is compacting context");
  }

  request(
    conversationId: string,
    afterInputSequence: number,
    headEventId: string | null,
  ): void {
    const status = this.operations.get(conversationId)?.status;
    if (status === "queued" || status === "running" || status === "stopping")
      return;
    this.operations.set(conversationId, {
      id: createId("evt"),
      revision: this.nextRevision(conversationId),
      reason: "manual",
      status: "queued",
      startedAt: this.now(),
      headEventId,
      attempt: 1,
      summaryPreview: "",
    });
    this.positions.set(conversationId, afterInputSequence);
    this.publish(conversationId);
  }

  pending(
    conversationId: string,
  ): { operation: CompactionOperation; afterInputSequence: number } | null {
    const operation = this.get(conversationId);
    return operation?.status === "queued"
      ? { operation, afterInputSequence: this.positions.get(conversationId)! }
      : null;
  }

  begin(
    conversationId: string,
    id: string,
    context: { executionId?: string; headEventId: string | null },
  ): CompactionOperation | undefined {
    const operation = this.operations.get(conversationId);
    if (operation?.id !== id || operation.status !== "queued") return;
    this.positions.delete(conversationId);
    this.update(conversationId, {
      ...context,
      status: "running",
      startedAt: this.now(),
    });
    this.publish(conversationId);
    return this.get(conversationId)!;
  }

  cancelQueued(conversationId: string): void {
    if (!this.pending(conversationId)) return;
    this.positions.delete(conversationId);
    this.update(conversationId, { status: "cancelled", endedAt: this.now() });
    this.publish(conversationId);
  }

  start(
    conversationId: string,
    reason: CompactionOperation["reason"],
    headEventId: string | null,
    executionId?: string,
  ): CompactionOperation {
    this.assertIdle(conversationId);
    const operation: CompactionOperation = {
      id: this.pending(conversationId)?.operation.id ?? createId("evt"),
      revision: this.nextRevision(conversationId),
      reason,
      status: "running",
      startedAt: this.now(),
      headEventId,
      attempt: 1,
      summaryPreview: "",
      ...(executionId ? { executionId } : {}),
    };
    this.positions.delete(conversationId);
    this.operations.set(conversationId, operation);
    this.publish(conversationId);
    return structuredClone(operation);
  }

  progress(
    conversationId: string,
    id: string,
    progress: { attempt: number; text: string },
  ): void {
    const operation = this.operations.get(conversationId);
    if (
      operation?.id !== id ||
      operation.status !== "running" ||
      (progress.attempt !== 1 && progress.attempt !== 2) ||
      progress.attempt < operation.attempt
    )
      return;
    this.update(conversationId, {
      attempt: progress.attempt,
      summaryPreview: progress.text.slice(-65_536),
    });
    if (!this.timers.has(conversationId)) {
      const timer = setTimeout(() => this.publish(conversationId), 50);
      timer.unref();
      this.timers.set(conversationId, timer);
    }
  }

  stopping(conversationId: string, id: string): void {
    const operation = this.operations.get(conversationId);
    if (operation?.id !== id || operation.status !== "running") return;
    this.update(conversationId, { status: "stopping" });
    this.publish(conversationId);
  }

  settle(
    conversationId: string,
    id: string,
    result:
      | { status: "completed"; summary: string }
      | { status: "failed"; errorMessage: string }
      | { status: "cancelled" },
  ): void {
    const operation = this.operations.get(conversationId);
    if (
      operation?.id !== id ||
      (operation.status !== "running" && operation.status !== "stopping")
    )
      return;
    this.positions.delete(conversationId);
    this.update(conversationId, {
      status: result.status,
      endedAt: this.now(),
      ...(result.status === "completed"
        ? { eventId: id, summaryPreview: result.summary.slice(-65_536) }
        : result.status === "failed"
          ? { errorMessage: result.errorMessage }
          : {}),
    });
    this.publish(conversationId);
  }

  delete(conversationId: string): void {
    this.clearTimer(conversationId);
    this.operations.delete(conversationId);
    this.positions.delete(conversationId);
    // Keep the counter: a caller may recreate the same conversation ID.
  }

  private nextRevision(conversationId: string): number {
    const revision = (this.revisions.get(conversationId) ?? 0) + 1;
    this.revisions.set(conversationId, revision);
    return revision;
  }

  private update(
    conversationId: string,
    patch: Partial<CompactionOperation>,
  ): void {
    this.operations.set(conversationId, {
      ...this.operations.get(conversationId)!,
      ...patch,
      revision: this.nextRevision(conversationId),
    });
  }

  private clearTimer(conversationId: string): void {
    clearTimeout(this.timers.get(conversationId));
    this.timers.delete(conversationId);
  }

  private publish(conversationId: string): void {
    this.clearTimer(conversationId);
    const compaction = this.get(conversationId);
    if (compaction)
      this.emit({ kind: "compaction_changed", conversationId, compaction });
  }
}
