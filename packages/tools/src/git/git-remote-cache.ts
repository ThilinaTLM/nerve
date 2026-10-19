import type { GithubCacheStatus } from "@nervekit/contracts/git";
import { GitWorkflowError, GitCommandError } from "./git-errors.js";

const failureCodes = new Set([
  "GH_CLI_UNAVAILABLE",
  "GH_AUTH_REQUIRED",
  "GH_NO_REMOTE",
  "GH_NO_GITHUB_REMOTE",
  "GH_RATE_LIMITED",
  "GH_API_UNAVAILABLE",
  "GH_FORBIDDEN",
  "GH_NOT_FOUND",
  "GH_API_FAILED",
  "GH_GRAPHQL_FAILED",
]);
/** Issue reads use gh directly, while PR reads already carry workflow codes.
 * Recognize diagnostics locally; retain only a fixed code, never their contents. */
function githubFailureCode(error: unknown): string | undefined {
  if (error instanceof GitWorkflowError)
    return failureCodes.has(error.code) ? error.code : undefined;
  if (!(error instanceof GitCommandError) || !error.command.startsWith("gh "))
    return undefined;
  const text = error.stderr;
  if (
    error.code === null &&
    /ENOENT|not recognized|executable.*not found/i.test(text)
  )
    return "GH_CLI_UNAVAILABLE";
  if (/gh auth login|not logged into|not authenticated|HTTP 401/i.test(text))
    return "GH_AUTH_REQUIRED";
  if (/API rate limit exceeded|rate limit.*exceeded|HTTP 429/i.test(text))
    return "GH_RATE_LIMITED";
  if (/no git remotes/i.test(text)) return "GH_NO_REMOTE";
  if (/none of the git remotes.*github|no GitHub remotes/i.test(text))
    return "GH_NO_GITHUB_REMOTE";
  if (/HTTP 403/i.test(text)) return "GH_FORBIDDEN";
  if (/HTTP 404|Could not resolve to a Repository/i.test(text))
    return "GH_NOT_FOUND";
  if (
    error.failureCategory === "timeout" ||
    /error connecting to|could not resolve host|dial tcp|network is unreachable|connection (?:refused|reset)|TLS handshake timeout|HTTP 50[0-9]/i.test(
      text,
    )
  )
    return "GH_API_UNAVAILABLE";
  return undefined;
}

export interface RemoteSnapshot<T> {
  status: GithubCacheStatus;
  value: T | null;
  refreshing: boolean;
  updatedAt: string | null;
  /** In-memory diagnostic only; never retain command output or error messages. */
  failureCode?: string;
}
interface Entry<T> {
  value: T | null;
  updatedAt: number | null;
  retryAt: number;
  failed: boolean;
  failureCode?: string;
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
          current.failureCode = undefined;
          current.updatedAt = this.now();
        })
        .catch((error: unknown) => {
          // Preserve both the previous value and its original observation time.
          current.failed = true;
          current.failureCode = githubFailureCode(error);
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
      ...(entry.failureCode ? { failureCode: entry.failureCode } : {}),
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
