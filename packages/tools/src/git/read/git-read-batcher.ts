import type {
  NativeGitProjectRepository,
  NativeGitProjectRepositoryResult,
  NativeGitProjectSnapshotOptions,
} from "@nervekit/native";
import { gitPathKey } from "../git-path-key.js";
import { runNativeGitProjectRead } from "./git-native-read-admission.js";

type Read = (
  repositories: NativeGitProjectRepository[],
  options: NativeGitProjectSnapshotOptions,
) => Promise<NativeGitProjectRepositoryResult[]>;
interface Request {
  repository: NativeGitProjectRepository;
  ignored: boolean;
  signal: AbortSignal;
  batch?: Batch;
  done: boolean;
  abort: () => void;
  resolve: (result: NativeGitProjectRepositoryResult) => void;
  reject: (error: unknown) => void;
}
interface Batch {
  requests: Request[];
  controller: AbortController;
  started: boolean;
  selected: Request[];
}

/** Microbatch only already-admitted repository heads. No repository acquires another
 * repository's lane, and isolated filtering is deliberately outside this dispatcher.
 */
export class GitReadBatcher {
  readonly #pending: Request[] = [];
  readonly #requests = new Set<Request>();
  readonly #flights = new Set<Promise<void>>();
  #scheduled = false;
  #closed = false;
  constructor(private readonly read: Read) {}

  enqueue(
    repository: NativeGitProjectRepository,
    ignored: boolean,
    signal: AbortSignal,
  ): Promise<NativeGitProjectRepositoryResult> {
    if (this.#closed || signal.aborted)
      return Promise.reject(
        signal.reason ?? new DOMException("Git read closed", "AbortError"),
      );
    return new Promise((resolve, reject) => {
      const finish = (
        result?: NativeGitProjectRepositoryResult,
        error?: unknown,
      ) => {
        if (request.done) return;
        request.done = true;
        signal.removeEventListener("abort", request.abort);
        this.#requests.delete(request);
        if (result) resolve(result);
        else reject(error);
      };
      const request: Request = {
        repository,
        ignored,
        signal,
        done: false,
        resolve: (result) => finish(result),
        reject: (error) => finish(undefined, error),
        abort: () => {
          const batch = request.batch;
          if (!batch?.started) {
            const index = this.#pending.indexOf(request);
            if (index >= 0) this.#pending.splice(index, 1);
            request.reject(
              signal.reason ??
                new DOMException("Git read cancelled", "AbortError"),
            );
          }
          // Once native starts, never settle/release a lane before actual completion.
          if (
            batch &&
            batch.requests.every((entry) => entry.done || entry.signal.aborted)
          )
            batch.controller.abort();
        },
      };
      this.#requests.add(request);
      this.#pending.push(request);
      signal.addEventListener("abort", request.abort, { once: true });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.#scheduled || this.#closed) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.flush();
    });
  }
  private flush(): void {
    while (!this.#closed && this.#flights.size < 2 && this.#pending.length) {
      const ignored = this.#pending[0].ignored;
      const ready = this.#pending
        .filter((entry) => !entry.done && entry.ignored === ignored)
        .slice(0, 128);
      for (const request of ready)
        this.#pending.splice(this.#pending.indexOf(request), 1);
      const batch: Batch = {
        requests: ready,
        controller: new AbortController(),
        started: false,
        selected: [],
      };
      for (const request of ready) request.batch = batch;
      const work = this.execute(batch, ignored);
      this.#flights.add(work);
      void work
        .finally(() => {
          this.#flights.delete(work);
          this.schedule();
        })
        .catch(() => {});
    }
  }
  private async execute(batch: Batch, ignored: boolean): Promise<void> {
    try {
      const results = await runNativeGitProjectRead(async (admitted) => {
        if (!batch.started) {
          batch.started = true;
          batch.selected = batch.requests.filter(
            (request) => !request.done && !request.signal.aborted,
          );
        }
        if (!batch.selected.length)
          throw new DOMException("Git read cancelled", "AbortError");
        return this.read(
          batch.selected.map((request) => request.repository),
          { includeIgnored: ignored, signal: admitted },
        );
      }, batch.controller.signal);
      if (results.length !== batch.selected.length)
        throw new Error("Invalid native Git batch result count");
      for (let index = 0; index < batch.selected.length; index++) {
        const request = batch.selected[index];
        const result = results[index];
        if (this.#closed || request.signal.aborted) {
          request.reject(
            request.signal.reason ??
              new DOMException("Git read closed", "AbortError"),
          );
          continue;
        }
        const same = (["workDir", "gitDir", "commonDir"] as const).every(
          (field) =>
            gitPathKey(request.repository[field]) ===
            gitPathKey(result.repository[field]),
        );
        if (
          !same ||
          request.repository.relativePath !== result.repository.relativePath
        )
          request.reject(
            new Error("Invalid native Git batch repository identity"),
          );
        else request.resolve(result);
      }
    } catch (error) {
      for (const request of batch.requests)
        request.reject(request.signal.aborted ? request.signal.reason : error);
    }
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const request of [...this.#requests]) {
      const batch = request.batch;
      if (!batch?.started)
        request.reject(new DOMException("Git read closed", "AbortError"));
      batch?.controller.abort();
    }
    this.#pending.length = 0;
    await Promise.allSettled([...this.#flights]);
  }
}
