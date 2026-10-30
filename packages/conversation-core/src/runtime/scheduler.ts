import { publishSummary } from "./publish-summary.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type { ToolCallService } from "../tool-calls/tool-call.service.js";
import type { AsyncBashService } from "../async-bash/async-bash.service.js";
import type { CompactionOperations } from "./compaction-operations.js";
import type { CoreEmitter } from "./core-change.js";
import type { ConversationRunner } from "./conversation-runner.js";
import { openExecutionId, type StatusService } from "./status.js";
import { shutdownReason } from "./shutdown.js";
import { hasRejectedPlan } from "./plan-rejection.js";

export class ConversationScheduler {
  private readonly slots = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  private readonly stopping = new Set<string>();
  private enabled = false;
  constructor(
    private readonly options: {
      storage: CoreStorage;
      inputs: InputQueueService;
      toolCalls: ToolCallService;
      asyncBash: AsyncBashService;
      runner: ConversationRunner;
      compactions: CompactionOperations;
      status: StatusService;
      emit: CoreEmitter;
    },
  ) {}
  enable(): void {
    this.enabled = true;
  }
  isExecuting(id: string): boolean {
    return this.slots.has(id) || this.stopping.has(id);
  }
  isProcessing(id: string): boolean {
    return this.slots.has(id);
  }
  wake(id: string): void {
    this.launch(id, false);
  }
  continue(id: string): void {
    this.setPaused(id, false);
    this.launch(id, true);
  }
  private launch(id: string, explicit: boolean): void {
    if (!this.enabled || this.isExecuting(id)) return;
    const conversation = this.options.storage.conversations.get(id);
    if (!conversation) {
      if (explicit) throw new Error("Conversation not found");
      return;
    }
    if (this.options.toolCalls.openRows(id).length) return;
    const existing = openExecutionId(this.options.storage, id);
    const pending = this.options.compactions.pending(id);
    if (!pending && conversation.paused) {
      // Restored reviews have no live runner. Complete them only after all sibling
      // tools settle; their later wakes must not leave a rejected execution open.
      const started = existing && this.options.storage.events.get(existing);
      if (
        existing &&
        started &&
        hasRejectedPlan(this.options.storage.events.since(id, started.sequence))
      )
        this.options.status.transition(id, {
          subtype: "execution_state",
          transition: "completed",
          executionId: existing,
        });
      return;
    }
    if (
      !pending &&
      !explicit &&
      !existing &&
      (!this.options.inputs.list(id).some((input) => input.wakeWhenIdle) ||
        !this.options.inputs.hasDeliverable(id, {
          kind: "execution_start",
          executionId: "",
        }))
    )
      return;
    const controller = new AbortController();
    // Reserve synchronously, before the runner appends events or delivery emits a wake.
    const done = Promise.resolve()
      .then(() =>
        pending
          ? this.options.runner.compactStandalone(id, controller.signal)
          : this.options.runner.run(
              id,
              controller.signal,
              existing ?? undefined,
            ),
      )
      .finally(() => {
        this.slots.delete(id);
        if (!this.stopping.has(id)) this.wake(id);
        if (!this.slots.has(id)) this.options.status.refresh(id);
      });
    this.slots.set(id, { controller, done });
    this.options.status.refresh(id);
    // Provider failures are durable runner transitions, not unhandled promises.
    void done.catch(() => {});
  }
  requestCompaction(id: string): void {
    const conversation = this.options.storage.conversations.get(id);
    if (!conversation) throw new Error("Conversation not found");
    this.options.compactions.request(
      id,
      conversation.nextInputSequence,
      conversation.headEventId,
    );
    this.wake(id);
  }
  cancelCompaction(id: string): void {
    this.options.compactions.cancelQueued(id);
  }
  pause(id: string): void {
    this.setPaused(id, true);
  }
  resume(id: string): void {
    this.setPaused(id, false);
    this.wake(id);
  }
  private setPaused(id: string, paused: boolean): void {
    const current = this.options.storage.conversations.get(id);
    if (!current) throw new Error("Conversation not found");
    if (current.paused === paused) return;
    this.options.storage.conversations.update(id, {
      paused,
    });
    publishSummary(this.options.storage, this.options.emit, id);
  }
  private async cancelOne(
    id: string,
    pause: boolean,
    reason: string,
  ): Promise<void> {
    this.stopping.add(id);
    try {
      if (pause) this.setPaused(id, true);
      this.options.compactions.cancelQueued(id);
      const slot = this.slots.get(id);
      const operation = this.options.compactions.get(id);
      if (operation) this.options.compactions.stopping(id, operation.id);
      slot?.controller.abort();
      await this.options.toolCalls.cancel(id, { reason });
      if (slot)
        await slot.done.catch((error) => {
          if (!slot.controller.signal.aborted) throw error;
        });
      const executionId = openExecutionId(this.options.storage, id);
      if (executionId)
        this.options.status.transition(id, {
          subtype: "execution_state",
          transition: "cancelled",
          executionId,
        });
    } finally {
      this.stopping.delete(id);
      this.options.status.refresh(id);
    }
  }
  async discard(
    ids: readonly string[],
    remove: () => Promise<void>,
  ): Promise<void> {
    for (const id of ids) {
      this.stopping.add(id);
      this.options.compactions.cancelQueued(id);
      this.slots.get(id)?.controller.abort(shutdownReason);
      this.options.inputs.discard(this.options.storage.inputs.ids(id));
    }
    try {
      await this.options.toolCalls.discard(
        ids.flatMap((id) => this.options.storage.toolCalls.ids(id)),
        async () => {
          await this.options.asyncBash.discard(
            ids.flatMap((id) => this.options.storage.asyncBash.ids(id)),
          );
          await Promise.allSettled(
            ids.flatMap((id) => this.slots.get(id)?.done ?? []),
          );
          await remove();
        },
      );
    } finally {
      for (const id of ids) this.stopping.delete(id);
    }
  }

  async stop(id: string): Promise<void> {
    if (!this.options.storage.conversations.get(id)) return;
    const ids = [id, ...this.options.storage.descendantConversationIds(id)];
    await Promise.all(
      ids.map((conversationId) =>
        this.cancelOne(
          conversationId,
          true,
          "Tool call cancelled by the user. Effects already performed are not undone.",
        ),
      ),
    );
    await this.options.asyncBash.cancelForConversations(ids);
  }
  async forcePush(id: string): Promise<void> {
    await this.cancelOne(
      id,
      false,
      "Tool call cancelled for a replacement prompt. Effects already performed are not undone.",
    );
    this.setPaused(id, false);
    if (
      this.options.inputs.hasDeliverable(id, {
        kind: "execution_start",
        executionId: "",
      })
    )
      this.continue(id);
  }
  async close(): Promise<void> {
    this.enabled = false;
    const slots = [...this.slots.values()];
    for (const [id, slot] of this.slots) {
      const operation = this.options.compactions.get(id);
      if (operation) this.options.compactions.stopping(id, operation.id);
      slot.controller.abort(shutdownReason);
    }
    // Durable work stays intact for crash-style recovery on the next start.
    await Promise.all([
      this.options.toolCalls.close(),
      ...slots.map((slot) => slot.done.catch(() => {})),
    ]);
  }
}
