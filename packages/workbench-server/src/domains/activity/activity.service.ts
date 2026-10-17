import { randomUUID } from "node:crypto";
import {
  isActivityRunning,
  type Activity,
  type ActivityActionResult,
} from "@nervekit/contracts/activity";

export type ActivityStart = Pick<
  Activity,
  "kind" | "title" | "scope" | "parentId"
> & {
  id?: string;
  status?: "queued" | "running";
};
export type ActivityProgress = Partial<
  Pick<Activity, "phase" | "message" | "progress">
> & { status?: "queued" | "running"; cancellable?: boolean };
export interface ActivityProducerActions {
  /** Request cancellation; false means the producer refused. Completion stays producer-owned. */
  cancel?: () => void | boolean | Promise<void | boolean>;
  /** Start new work through the producer's normal authorization/policy path. */
  retry?: () => string | Promise<string>;
}
export interface ActivityHandle {
  readonly id: string;
  progress(patch: ActivityProgress): void;
  succeed(): void;
  fail(error: NonNullable<Activity["error"]>): void;
  cancelled(): void;
  interrupt(): void;
}
export interface ActivityProducerPort {
  start(
    input: ActivityStart,
    actions?: ActivityProducerActions,
  ): ActivityHandle;
}

/** Session-only reporting registry, not a scheduler. Transport coalesces by activity ID. */
export class ActivityService implements ActivityProducerPort {
  #entries = new Map<string, Activity>();
  #actions = new Map<string, ActivityProducerActions>();
  #pending = new Set<string>();
  #closed = false;
  constructor(
    private readonly publish: (
      activity: Activity,
      removed?: boolean,
    ) => unknown,
    private readonly finishedLimit = 200,
  ) {}

  start(
    input: ActivityStart,
    actions: ActivityProducerActions = {},
  ): ActivityHandle {
    if (this.#closed) throw new Error("Activity service is closed.");
    const id = input.id ?? `activity_${randomUUID()}`;
    if (this.#entries.has(id))
      throw new Error(`Activity already exists: ${id}`);
    const now = new Date().toISOString();
    const entry: Activity = {
      ...structuredClone(input),
      id,
      status: input.status ?? "running",
      revision: 1,
      startedAt: now,
      updatedAt: now,
      actions: { cancel: !!actions.cancel, retry: false },
    };
    this.#entries.set(id, entry);
    this.#actions.set(id, actions);
    this.emit(entry);
    const finish = (status: Activity["status"], error?: Activity["error"]) => {
      const current = this.#entries.get(id);
      if (
        !current ||
        this.#actions.get(id) !== actions ||
        !isActivityRunning(current)
      )
        return;
      const now = new Date().toISOString();
      const next = {
        ...current,
        status,
        error: error ? structuredClone(error) : undefined,
        updatedAt: now,
        finishedAt: now,
        revision: current.revision + 1,
        actions: {
          cancel: false,
          retry: !!actions.retry && status !== "succeeded",
        },
      };
      this.#entries.delete(id);
      this.#entries.set(id, next);
      this.emit(next);
      this.evict();
    };
    return {
      id,
      progress: ({ cancellable, ...patch }) => {
        const current = this.#entries.get(id);
        if (
          !current ||
          this.#actions.get(id) !== actions ||
          !isActivityRunning(current)
        )
          return;
        const next = {
          ...current,
          ...structuredClone(patch),
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
          actions: {
            ...current.actions,
            cancel: !!actions.cancel && (cancellable ?? current.actions.cancel),
          },
        };
        this.#entries.set(id, next);
        this.emit(next);
      },
      succeed: () => finish("succeeded"),
      fail: (error) => finish("failed", error),
      cancelled: () => finish("cancelled"),
      interrupt: () => finish("interrupted"),
    };
  }
  list(): Activity[] {
    return structuredClone([...this.#entries.values()].reverse());
  }
  async cancel(id: string): Promise<ActivityActionResult> {
    return this.act(id, "cancel");
  }
  async retry(id: string): Promise<ActivityActionResult> {
    return this.act(id, "retry");
  }
  private async act(
    id: string,
    kind: "cancel" | "retry",
  ): Promise<ActivityActionResult> {
    const entry = this.#entries.get(id);
    const action = this.#actions.get(id)?.[kind];
    if (!entry || !entry.actions[kind] || !action)
      return { accepted: false, reason: "Action is no longer available." };
    if (this.#pending.has(id))
      return { accepted: false, reason: "An action is already in progress." };
    this.#pending.add(id);
    try {
      const result = await action();
      if (result === false)
        return {
          accepted: false,
          reason: "The producer could not cancel this activity.",
        };
      const current = this.#entries.get(id);
      if (kind === "cancel" && current && isActivityRunning(current)) {
        const next = {
          ...current,
          revision: current.revision + 1,
          actions: { ...current.actions, cancel: false },
        };
        this.#entries.set(id, next);
        this.emit(next);
      }
      return {
        accepted: true,
        activityId: typeof result === "string" ? result : id,
      };
    } catch {
      return {
        accepted: false,
        reason:
          "Activity action failed. Check producer status and permissions.",
      };
    } finally {
      this.#pending.delete(id);
      this.evict();
    }
  }
  dismiss(id: string): number {
    const entry = this.#entries.get(id);
    if (!entry || isActivityRunning(entry)) return 0;
    this.#entries.delete(id);
    this.#actions.delete(id);
    this.emit(entry, true);
    return 1;
  }
  clear(): number {
    let removed = 0;
    for (const id of this.#entries.keys()) removed += this.dismiss(id);
    return removed;
  }
  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const [id, entry] of this.#entries) {
      if (
        !isActivityRunning(entry) &&
        !entry.actions.cancel &&
        !entry.actions.retry
      )
        continue;
      const now = new Date().toISOString();
      const next: Activity = {
        ...entry,
        status: isActivityRunning(entry) ? "interrupted" : entry.status,
        revision: entry.revision + 1,
        updatedAt: now,
        finishedAt: entry.finishedAt ?? now,
        actions: { cancel: false, retry: false },
      };
      this.#entries.set(id, next);
      this.emit(next);
    }
    this.#actions.clear();
    this.evict();
  }
  private evict(): void {
    const finished = [...this.#entries.values()].filter(
      (entry) => !isActivityRunning(entry),
    );
    while (finished.length > Math.max(0, this.finishedLimit)) {
      const entry = finished.shift()!;
      this.#entries.delete(entry.id);
      this.#actions.delete(entry.id);
      this.emit(entry, true);
    }
  }
  private emit(entry: Activity, removed = false): void {
    try {
      void Promise.resolve(
        this.publish(
          structuredClone(
            removed ? { ...entry, revision: entry.revision + 1 } : entry,
          ),
          removed,
        ),
      ).catch(() => undefined);
    } catch {
      /* Reporting cannot break producer work. */
    }
  }
}
