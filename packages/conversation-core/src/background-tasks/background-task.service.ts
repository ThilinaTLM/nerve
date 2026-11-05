import type {
  TaskHandle,
  TaskKind,
  TaskRef,
  TaskRunner,
  TaskTerminal,
} from "./background-task.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type { CoreStorage } from "../storage/core-storage.js";
import { buildTaskNotice } from "./task-notice.js";

/**
 * Lifecycle shared by every background task: watch, recover, cancel, discard, and settle
 * exactly once with the parent notice in the same transaction.
 */
export class BackgroundTaskService {
  private readonly runners = new Map<TaskKind, TaskRunner>();
  private readonly handles = new Map<string, TaskHandle>();
  private readonly watchers = new Map<string, Promise<void>>();
  private readonly discarded = new Set<string>();

  constructor(
    private readonly options: {
      storage: CoreStorage;
      inputs: InputQueueService;
    },
  ) {}

  register(runner: TaskRunner): void {
    this.runners.set(runner.kind, runner);
  }

  /** Start watching live work until it settles. */
  adopt(ref: TaskRef, handle: TaskHandle): void {
    if (this.watchers.has(ref.id)) return;
    this.handles.set(ref.id, handle);
    const runner = this.runner(ref);
    const watcher = (async () => {
      let terminal: TaskTerminal;
      try {
        terminal = await handle.wait();
      } catch {
        terminal = await runner.describe(ref, "interrupted");
      }
      this.settle(ref, terminal);
    })().finally(() => {
      this.handles.delete(ref.id);
      this.watchers.delete(ref.id);
    });
    this.watchers.set(ref.id, watcher);
  }

  async recover(parentConversationId?: string): Promise<void> {
    for (const runner of this.runners.values())
      for (const ref of runner.running(parentConversationId)) {
        if (this.watchers.has(ref.id)) continue;
        const handle = await this.reattach(runner, ref);
        if (handle) this.adopt(ref, handle);
        else this.settle(ref, await runner.describe(ref, "interrupted"));
      }
  }

  async cancel(ref: TaskRef): Promise<void> {
    const runner = this.runner(ref);
    if (!runner.isRunning(ref)) return;
    const handle =
      this.handles.get(ref.id) ?? (await this.reattach(runner, ref));
    if (!handle) {
      this.settle(ref, await runner.describe(ref, "interrupted"));
      return;
    }
    await handle.cancel();
    this.settle(ref, await runner.describe(ref, "cancelled"));
    this.handles.delete(ref.id);
  }

  async cancelForConversations(ids: readonly string[]): Promise<void> {
    for (const id of ids)
      for (const runner of this.runners.values())
        for (const ref of runner.running(id)) await this.cancel(ref);
  }

  /** Cancel and forget tasks whose conversation is going away; they leave no notice. */
  async discard(refs: readonly TaskRef[]): Promise<void> {
    for (const ref of refs) this.discarded.add(ref.id);
    try {
      for (const ref of refs) {
        const runner = this.runner(ref);
        // Never cancel work whose ownership cannot be verified.
        const handle =
          this.handles.get(ref.id) ??
          (runner.isRunning(ref)
            ? await this.reattach(runner, ref)
            : undefined);
        await handle?.cancel();
      }
      await Promise.allSettled(
        refs.flatMap((ref) => this.watchers.get(ref.id) ?? []),
      );
    } finally {
      for (const ref of refs) {
        this.discarded.delete(ref.id);
        this.handles.delete(ref.id);
      }
    }
  }

  /**
   * Commit a terminal state together with its parent notice. A notice that cannot be
   * enqueued aborts the transaction (and any enclosing one), so no task ends silently.
   */
  settle(ref: TaskRef, terminal: TaskTerminal): void {
    if (this.discarded.has(ref.id)) return;
    const runner = this.runner(ref);
    this.options.storage.transaction(() => {
      if (runner.persist?.(ref, terminal) === false) return;
      if (runner.suppressNotice?.(ref, terminal)) return;
      this.options.inputs.enqueueNotice(buildTaskNotice(ref, terminal));
    });
    runner.changed?.(ref);
  }

  private async reattach(
    runner: TaskRunner,
    ref: TaskRef,
  ): Promise<TaskHandle | undefined> {
    try {
      return await runner.recover(ref);
    } catch {
      return undefined; // Unverifiable work is interrupted.
    }
  }

  private runner(ref: TaskRef): TaskRunner {
    const runner = this.runners.get(ref.kind);
    if (!runner) throw new Error(`No runner for ${ref.kind} tasks`);
    return runner;
  }
}
