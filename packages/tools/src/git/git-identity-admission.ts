interface Request {
  execute: (key: string) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abort: () => void;
  phase: "identity" | "execution" | "done";
}
interface Group {
  key: string | symbol;
  identity: (signal: AbortSignal) => Promise<string>;
  controller: AbortController;
  requests: Set<Request>;
}

/** Bound requests before filesystem work, and separately bound uncancellable OS lookups.
 * Same-path waiters share one lookup/slot. Cancelled callers settle promptly, while a
 * cancelled OS lookup retains its resolver slot until it actually settles.
 */
export class GitIdentityAdmission {
  readonly #queue: Group[] = [];
  readonly #groups = new Map<string | symbol, Group>();
  #requests = 0;
  #resolvers = 0;
  constructor(
    readonly limit = 256,
    readonly resolverLimit = 16,
  ) {}

  run<T>(
    identity: (signal: AbortSignal) => Promise<string>,
    execute: (key: string) => Promise<T>,
    signal?: AbortSignal,
    identityKey?: string,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.#requests >= this.limit)
      return Promise.reject(new Error("Git operation admission is full"));
    this.#requests++;
    const key = identityKey ?? Symbol();
    let group = this.#groups.get(key);
    if (!group) {
      group = {
        key,
        identity,
        controller: new AbortController(),
        requests: new Set(),
      };
      this.#groups.set(key, group);
      this.#queue.push(group);
    }
    const owner = group;
    return new Promise<T>((resolve, reject) => {
      const finish = () => {
        if (request.phase === "done") return false;
        request.phase = "done";
        this.#requests--;
        owner.requests.delete(request);
        signal?.removeEventListener("abort", request.abort);
        return true;
      };
      const request: Request = {
        execute,
        resolve: (value) => {
          if (finish()) resolve(value as T);
        },
        reject: (error) => {
          if (finish()) reject(error);
        },
        signal,
        phase: "identity",
        abort: () => {
          // Execution owns termination and awaits managed.closed before settling.
          if (request.phase !== "identity") return;
          request.reject(
            signal?.reason ?? new DOMException("Cancelled", "AbortError"),
          );
          if (!owner.requests.size) {
            if (this.#groups.get(key) === owner) this.#groups.delete(key);
            owner.controller.abort(signal?.reason);
            const index = this.#queue.indexOf(owner);
            if (index >= 0) this.#queue.splice(index, 1);
          }
          this.#drain();
        },
      };
      owner.requests.add(request);
      signal?.addEventListener("abort", request.abort, { once: true });
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#resolvers < this.resolverLimit && this.#queue.length) {
      const group = this.#queue.shift()!;
      this.#resolvers++;
      void Promise.resolve()
        .then(() => {
          group.controller.signal.throwIfAborted();
          return group.identity(group.controller.signal);
        })
        .then((key) => {
          if (this.#groups.get(group.key) === group)
            this.#groups.delete(group.key);
          // Set iteration preserves submission order for all same-path waiters.
          for (const request of [...group.requests]) {
            if (request.phase === "done") continue;
            if (request.signal?.aborted) {
              request.reject(request.signal.reason);
              continue;
            }
            request.phase = "execution";
            void Promise.resolve()
              .then(() => request.execute(key))
              .then(request.resolve, request.reject);
          }
          group.requests.clear();
        })
        .catch((error: unknown) => {
          if (this.#groups.get(group.key) === group)
            this.#groups.delete(group.key);
          for (const request of [...group.requests]) request.reject(error);
        })
        .finally(() => {
          if (this.#groups.get(group.key) === group)
            this.#groups.delete(group.key);
          this.#resolvers--;
          this.#drain();
        });
    }
  }
}
