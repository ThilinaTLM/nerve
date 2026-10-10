import type { CoreStorage } from "../storage/core-storage.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type { ToolCallService } from "../tool-calls/tool-call.service.js";
import type { AsyncBashService } from "../async-bash/async-bash.service.js";
import type { CoreEmitter } from "./core-change.js";
import type { ConversationRunner } from "./conversation-runner.js";
import { openExecutionId, type StatusService } from "./status.js";
import { shutdownReason } from "./shutdown.js";

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
    if (conversation.paused || this.options.toolCalls.openRows(id).length)
      return;
    const existing = openExecutionId(this.options.storage, id);
    if (
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
        this.options.runner.run(id, controller.signal, existing ?? undefined),
      )
      .finally(() => {
        this.slots.delete(id);
        if (!this.stopping.has(id)) this.wake(id);
      });
    this.slots.set(id, { controller, done });
    // Provider failures are durable runner transitions, not unhandled promises.
    void done.catch(() => {});
  }
  compact(id: string): Promise<void> {
    if (this.isExecuting(id)) throw new Error("Conversation is executing");
    const controller = new AbortController();
    const done = Promise.resolve()
      .then(() => this.options.runner.compact(id, controller.signal))
      .finally(() => {
        this.slots.delete(id);
        if (!this.stopping.has(id)) this.wake(id);
      });
    this.slots.set(id, { controller, done });
    return done;
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
    this.options.emit({
      kind: "conversation_changed",
      summary: this.options.storage.conversations.getSummary(id)!,
    });
  }
  private async cancelOne(id: string, pause: boolean): Promise<void> {
    this.stopping.add(id);
    try {
      if (pause) this.setPaused(id, true);
      const slot = this.slots.get(id);
      slot?.controller.abort();
      await this.options.toolCalls.cancel(id);
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
    }
  }
  async stop(id: string): Promise<void> {
    if (!this.options.storage.conversations.get(id)) return;
    const ids = [id, ...this.options.storage.descendantConversationIds(id)];
    await Promise.all(
      ids.map((conversationId) => this.cancelOne(conversationId, true)),
    );
    await this.options.asyncBash.cancelForConversations(ids);
  }
  async forcePush(id: string): Promise<void> {
    await this.cancelOne(id, false);
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
    for (const slot of slots) slot.controller.abort(shutdownReason);
    // Durable work stays intact for crash-style recovery on the next start.
    await Promise.all([
      this.options.toolCalls.close(),
      ...slots.map((slot) => slot.done.catch(() => {})),
    ]);
  }
}
