import { isActivityRunning, type Activity } from "@nervekit/contracts/activity";

type Update = { activity: Activity; removed?: boolean };
interface ActivityControllerDeps {
  list(): Promise<Activity[]>;
  subscribe(handler: (update: Update) => void): () => void;
  changed(activities: Activity[]): void;
  error(error: unknown): void;
  /** Only accepted live transitions, never snapshots or stale/tombstoned events. */
  failed?(activity: Activity): void;
}
/** Subscribe before snapshot; buffer events so an older snapshot cannot overwrite them. */
export class ActivityController {
  #entries = new Map<string, Activity>();
  #tombstones = new Map<string, number>();
  #unsubscribe?: () => void;
  #generation = 0;
  #buffer?: Update[];
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
  async refresh(): Promise<void> {
    if (!this.#unsubscribe) return;
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
      for (const update of this.#buffer ?? []) this.apply(update);
      const removed = new Set(
        (this.#buffer ?? [])
          .filter((update) => update.removed)
          .map((update) => update.activity.id),
      );
      for (const entry of previous.values()) {
        if (this.#entries.has(entry.id) || removed.has(entry.id)) continue;
        if (isActivityRunning(entry)) {
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
      this.changed();
    } catch (error) {
      if (generation === this.#generation) this.deps.error(error);
    } finally {
      if (generation === this.#generation) this.#buffer = undefined;
    }
  }
  dismissLocal(id: string): void {
    const entry = this.#entries.get(id);
    if (entry && !isActivityRunning(entry))
      this.apply({
        activity: { ...entry, revision: entry.revision + 1 },
        removed: true,
      });
    this.changed();
  }
  clearLocal(): void {
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
  }
  private apply(update: Update): boolean {
    const current = this.#entries.get(update.activity.id);
    if (update.removed) {
      if (
        (this.#tombstones.get(update.activity.id) ?? -1) >=
        update.activity.revision
      )
        return false;
      if (current && current.revision > update.activity.revision) return false;
      this.#entries.delete(update.activity.id);
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
    if (current && update.activity.revision <= current.revision) return false;
    this.#entries.set(update.activity.id, update.activity);
    return true;
  }
  private changed(): void {
    const entries = [...this.#entries.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    let finished = 0;
    for (const entry of entries)
      if (!isActivityRunning(entry) && ++finished > 200)
        this.#entries.delete(entry.id);
    this.deps.changed(entries.filter((entry) => this.#entries.has(entry.id)));
  }
}
