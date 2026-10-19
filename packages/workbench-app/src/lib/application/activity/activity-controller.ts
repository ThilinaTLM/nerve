import { isActivityRunning, type Activity } from "@nervekit/contracts/activity";

export type ActivityStartedInput = Pick<
  Activity,
  "id" | "kind" | "title" | "scope"
> &
  Pick<Partial<Activity>, "parentId">;
export interface ActivityStartedObserver {
  observeStarted(input: ActivityStartedInput): void;
}

export interface ActivityNoticeInput {
  key: string;
  title: string;
  status: "succeeded" | "failed";
  message?: string;
  scope?: Activity["scope"];
}

type Update = { activity: Activity; removed?: boolean };
interface ActivityControllerDeps {
  list(): Promise<Activity[]>;
  subscribe(handler: (update: Update) => void): () => void;
  changed(activities: Activity[]): void;
  /** First successful snapshot, excluding entries observed live during its read. */
  baseline?(activities: Activity[]): void;
  error(error: unknown): void;
  /** Only accepted live transitions, never snapshots or stale/tombstoned events. */
  failed?(activity: Activity): void;
}
/** Subscribe before snapshot; buffer events so an older snapshot cannot overwrite them. */
export class ActivityController implements ActivityStartedObserver {
  #entries = new Map<string, Activity>();
  // Completed client notices never participate in daemon reconciliation or RPC.
  #notices = new Map<string, Activity>();
  #tombstones = new Map<string, number>();
  #unsubscribe?: () => void;
  #generation = 0;
  #baselined = false;
  #buffer?: Update[];
  #refreshQueued?: object;
  #refreshAfterCurrent = false;
  #localInterruptions = new Map<string, number>();
  constructor(private readonly deps: ActivityControllerDeps) {}
  start(): void {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.deps.subscribe((update) => {
      if (this.#buffer) this.#buffer.push(update);
      const previous = this.#entries.get(update.activity.id);
      const accepted = this.apply(update);
      this.changed();
      if (
        accepted &&
        !update.removed &&
        update.activity.status === "failed" &&
        previous?.status !== "failed"
      )
        this.deps.failed?.(update.activity);
    });
    void this.refresh();
  }
  observeStarted(input: ActivityStartedInput): void {
    if (this.#entries.has(input.id) || this.#tombstones.has(input.id)) return;
    const now = new Date().toISOString();
    const activity: Activity = {
      ...structuredClone(input),
      revision: 0,
      status: "queued",
      startedAt: now,
      updatedAt: now,
      actions: { cancel: false, retry: false },
    };
    this.#entries.set(activity.id, activity);
    // A snapshot requested before this acknowledgment cannot establish its absence.
    this.#buffer?.push({ activity });
    this.changed();
    this.scheduleRefresh();
  }
  notify(input: ActivityNoticeInput): void {
    const previous = this.#notices.get(input.key);
    const now = new Date().toISOString();
    this.#notices.delete(input.key);
    this.#notices.set(input.key, {
      // A replacement is new feedback: id-based read/attention state must reset.
      id: `client-notice:${crypto.randomUUID()}`,
      kind: "client.notice",
      title: input.title,
      status: input.status,
      message: input.message,
      scope: input.scope ? structuredClone(input.scope) : undefined,
      error:
        input.status === "failed" && input.message !== undefined
          ? { message: input.message }
          : undefined,
      revision: (previous?.revision ?? 0) + 1,
      startedAt: now,
      updatedAt: now,
      finishedAt: now,
      actions: { cancel: false, retry: false },
    });
    this.changed();
  }
  isClientNotice(id: string): boolean {
    return [...this.#notices.values()].some((entry) => entry.id === id);
  }
  clearClientNotices(): void {
    this.#notices.clear();
    this.changed();
  }
  private scheduleRefresh(): void {
    if (!this.#unsubscribe) return;
    if (this.#buffer) {
      this.#refreshAfterCurrent = true;
      return;
    }
    if (this.#refreshQueued) return;
    const token = (this.#refreshQueued = {});
    queueMicrotask(() => {
      if (this.#refreshQueued !== token) return;
      this.#refreshQueued = undefined;
      if (this.#unsubscribe) void this.refresh();
    });
  }
  async refresh(): Promise<void> {
    if (!this.#unsubscribe) return;
    this.#refreshQueued = undefined;
    // This read starts after all acknowledgments already observed, covering queued refresh demand.
    this.#refreshAfterCurrent = false;
    const generation = ++this.#generation;
    this.#buffer = [];
    try {
      const snapshot = await this.deps.list();
      if (generation !== this.#generation) return;
      const previous = this.#entries;
      this.#entries = new Map(
        snapshot
          .filter(
            (entry) => entry.revision > (this.#tombstones.get(entry.id) ?? -1),
          )
          .map((entry) => [entry.id, entry]),
      );
      for (const id of this.#entries.keys())
        this.#localInterruptions.delete(id);
      for (const update of this.#buffer ?? []) this.apply(update);
      const removed = new Set(
        (this.#buffer ?? [])
          .filter((update) => update.removed)
          .map((update) => update.activity.id),
      );
      for (const entry of previous.values()) {
        if (this.#entries.has(entry.id) || removed.has(entry.id)) continue;
        if (isActivityRunning(entry)) {
          this.#localInterruptions.set(entry.id, entry.revision);
          const now = new Date().toISOString();
          this.#entries.set(entry.id, {
            ...entry,
            status: "interrupted",
            revision: entry.revision + 1,
            finishedAt: now,
            updatedAt: now,
            actions: { cancel: false, retry: false },
            message:
              "No longer reported by the daemon. Work may have been interrupted.",
          });
        } else if (entry.status === "interrupted")
          this.#entries.set(entry.id, entry);
      }
      if (!this.#baselined) {
        this.#baselined = true;
        const liveIds = new Set(
          (this.#buffer ?? []).map((update) => update.activity.id),
        );
        this.deps.baseline?.(
          snapshot.filter(
            (entry) => this.#entries.has(entry.id) && !liveIds.has(entry.id),
          ),
        );
      }
      this.changed();
    } catch (error) {
      if (generation === this.#generation) this.deps.error(error);
    } finally {
      if (generation === this.#generation) {
        this.#buffer = undefined;
        if (this.#refreshAfterCurrent) {
          this.#refreshAfterCurrent = false;
          this.scheduleRefresh();
        }
      }
    }
  }
  dismissLocal(id: string): void {
    for (const [key, notice] of this.#notices)
      if (notice.id === id) this.#notices.delete(key);
    const entry = this.#entries.get(id);
    if (entry && !isActivityRunning(entry))
      this.apply({
        activity: { ...entry, revision: entry.revision + 1 },
        removed: true,
      });
    this.changed();
  }
  clearLocal(): void {
    this.#notices.clear();
    for (const entry of this.#entries.values())
      if (!isActivityRunning(entry))
        this.apply({
          activity: { ...entry, revision: entry.revision + 1 },
          removed: true,
        });
    this.changed();
  }
  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    ++this.#generation;
    this.#buffer = undefined;
    this.#refreshQueued = undefined;
    this.#refreshAfterCurrent = false;
  }
  private apply(update: Update): boolean {
    const current = this.#entries.get(update.activity.id);
    const interruptedRevision = this.#localInterruptions.get(
      update.activity.id,
    );
    if (update.removed) {
      if (
        (this.#tombstones.get(update.activity.id) ?? -1) >=
        update.activity.revision
      )
        return false;
      if (
        current &&
        (interruptedRevision ?? current.revision) > update.activity.revision
      )
        return false;
      this.#entries.delete(update.activity.id);
      this.#localInterruptions.delete(update.activity.id);
      this.#tombstones.set(update.activity.id, update.activity.revision);
      if (this.#tombstones.size > 400)
        this.#tombstones.delete(this.#tombstones.keys().next().value!);
      return true;
    }
    if (
      (this.#tombstones.get(update.activity.id) ?? -1) >=
      update.activity.revision
    )
      return false;
    if (
      current &&
      (interruptedRevision === undefined
        ? update.activity.revision <= current.revision
        : update.activity.revision < interruptedRevision)
    )
      return false;
    this.#localInterruptions.delete(update.activity.id);
    this.#entries.set(update.activity.id, update.activity);
    return true;
  }
  private changed(): void {
    const entries = [
      ...this.#entries.values(),
      ...[...this.#notices.values()].reverse(),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Local terminal entries share the same 200-finished display budget.
    let finished = 0;
    const keptIds = new Set<string>();
    for (const entry of entries)
      if (isActivityRunning(entry) || ++finished <= 200) keptIds.add(entry.id);
    for (const id of this.#entries.keys())
      if (!keptIds.has(id)) this.#entries.delete(id);
    for (const [key, notice] of this.#notices)
      if (!keptIds.has(notice.id)) this.#notices.delete(key);
    for (const id of this.#localInterruptions.keys())
      if (!this.#entries.has(id)) this.#localInterruptions.delete(id);
    this.deps.changed(entries.filter((entry) => keptIds.has(entry.id)));
  }
}
