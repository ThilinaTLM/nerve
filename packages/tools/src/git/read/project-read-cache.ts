export interface GitProjectReadFreshness {
  stale: boolean;
}
interface Entry<T> {
  root: string;
  expires: number;
  controller: AbortController;
  value: Promise<T>;
  pending: boolean;
  freshness: GitProjectReadFreshness;
}
type Loader<T> = (
  signal: AbortSignal,
  freshness: GitProjectReadFreshness,
) => Promise<T>;

/** Hard generations reject old consumers and await actual work on close. Uncertain
 * polls expire data without interrupting active work; one demand-owned follow-up
 * may run, never a self-sustaining background retry loop.
 */
export class GitProjectReadCache<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #loads = new Set<Promise<T>>();
  #closed = false;
  constructor(
    readonly limit = 32,
    readonly ttlMs = 30_000,
    readonly now = Date.now,
  ) {}
  get(
    projectId: string,
    root: string,
    load: Loader<T>,
    supersede = false,
  ): Promise<T> {
    if (this.#closed)
      return Promise.reject(new Error("Git project reads are closed"));
    const cached = this.#entries.get(projectId);
    if (cached?.root === root && !supersede) {
      if (cached.pending || cached.expires > this.now()) return cached.value;
      // Keep the hard-generation signal shared across deferred replacements, so
      // real changes still abort consumers doing later metadata summarization.
      if (cached.freshness.stale)
        return this.start(projectId, root, load, cached.controller);
    }
    this.invalidate(projectId);
    if (this.#entries.size >= this.limit)
      this.invalidate(this.#entries.keys().next().value!);
    return this.start(projectId, root, load);
  }
  private start(
    projectId: string,
    root: string,
    load: Loader<T>,
    controller = new AbortController(),
    followup = true,
  ): Promise<T> {
    const freshness = { stale: false };
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    const work = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return load(controller.signal, freshness);
    });
    this.#loads.add(work);
    void work
      .finally(() => {
        this.#loads.delete(work);
      })
      .catch(() => {});
    const entry: Entry<T> = {
      root,
      controller,
      freshness,
      pending: true,
      expires: Infinity,
      value: undefined!,
    };
    const value = Promise.race([work, cancelled])
      .then((result) => {
        controller.signal.throwIfAborted();
        if (this.#entries.get(projectId) !== entry)
          throw new DOMException("Git refresh superseded", "AbortError");
        entry.pending = false;
        entry.expires = freshness.stale ? 0 : this.now() + this.ttlMs;
        if (freshness.stale && followup)
          queueMicrotask(() => {
            if (
              !this.#closed &&
              !controller.signal.aborted &&
              this.#entries.get(projectId) === entry
            ) {
              // This internal follow-up cannot itself schedule another one. A later
              // explicit demand may refresh again, but idle polls alone never do.
              void this.start(projectId, root, load, controller, false).catch(
                () => {},
              );
            }
          });
        return result;
      })
      .catch((error: unknown) => {
        if (this.#entries.get(projectId) === entry) {
          entry.pending = false;
          entry.freshness.stale = true;
          entry.expires = 0;
        }
        throw error;
      })
      .finally(() => controller.signal.removeEventListener("abort", abort));
    entry.value = value;
    this.#entries.set(projectId, entry);
    return value;
  }
  invalidate(projectId: string, options: { uncertain?: boolean } = {}): void {
    const previous = this.#entries.get(projectId);
    if (options.uncertain) {
      if (previous) {
        previous.freshness.stale = true;
        previous.expires = 0;
      }
      return;
    }
    this.#entries.delete(projectId);
    previous?.controller.abort(
      new DOMException("Git refresh superseded", "AbortError"),
    );
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const id of this.#entries.keys()) this.invalidate(id);
    await Promise.allSettled([...this.#loads]);
  }
}
