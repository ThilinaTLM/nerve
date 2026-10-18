import type { GithubCacheStatus } from "@nervekit/contracts/git";
export interface RemoteSnapshot<T> {
  status: GithubCacheStatus;
  value: T | null;
  refreshing: boolean;
  updatedAt: string | null;
}
interface Entry<T> {
  value: T | null;
  updatedAt: number | null;
  retryAt: number;
  failed: boolean;
  pending?: Promise<void>;
  controller?: AbortController;
}

/** Bounded stale-while-revalidate cache; even cold reads never await the remote. */
export class GitRemoteCache<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #work = new Set<Promise<void>>();
  readonly #listeners = new Set<(key: string) => void>();
  #closed = false;
  constructor(
    readonly ttlMs = 60_000,
    readonly limit = 64,
    readonly now = Date.now,
  ) {}
  onSettled(listener: (key: string) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  read(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    refresh = false,
  ): RemoteSnapshot<T> {
    if (this.#closed) throw new Error("Git remote cache is closed");
    let entry = this.#entries.get(key);
    if (!entry) {
      if (this.#entries.size >= this.limit) {
        const oldest = this.#entries.keys().next().value;
        if (oldest !== undefined) {
          this.#entries.get(oldest)?.controller?.abort();
          this.#entries.delete(oldest);
        }
      }
      entry = { value: null, updatedAt: null, retryAt: 0, failed: false };
      this.#entries.set(key, entry);
    }
    if (!entry.pending && (refresh || this.now() >= entry.retryAt)) {
      const current = entry;
      const controller = new AbortController();
      current.controller = controller;
      current.pending = Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted();
          return load(controller.signal);
        })
        .then((value) => {
          if (controller.signal.aborted) return;
          current.value = value;
          current.failed = false;
          current.updatedAt = this.now();
        })
        .catch(() => {
          // Preserve both the previous value and its original observation time.
          current.failed = true;
        })
        .finally(() => {
          current.retryAt =
            this.now() +
            (current.failed ? Math.min(this.ttlMs, 60_000) : this.ttlMs);
          current.pending = undefined;
          current.controller = undefined;
          if (!this.#closed && this.#entries.get(key) === current) {
            for (const listener of [...this.#listeners]) {
              try {
                void Promise.resolve(listener(key)).catch(() => {});
              } catch {
                /* Freshness reporting never breaks the fetch lifecycle. */
              }
            }
          }
        });
      const pending = current.pending;
      this.#work.add(pending);
      void pending
        .finally(() => {
          this.#work.delete(pending);
        })
        .catch(() => {});
    }
    return {
      status: entry.pending
        ? entry.updatedAt === null
          ? "loading"
          : "stale"
        : entry.updatedAt === null
          ? "unavailable"
          : entry.failed
            ? "stale"
            : "fresh",
      value: entry.value,
      refreshing: !!entry.pending,
      updatedAt:
        entry.updatedAt === null
          ? null
          : new Date(entry.updatedAt).toISOString(),
    };
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#listeners.clear();
    for (const entry of this.#entries.values()) entry.controller?.abort();
    this.#entries.clear();
    await Promise.allSettled([...this.#work]);
  }
}
