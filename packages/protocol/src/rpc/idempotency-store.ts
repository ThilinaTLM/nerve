import type {
  IdempotencyExecution,
  IdempotencyOutcome,
  IdempotencyStorePort,
} from "./rpc.js";

export interface IdempotencyEntry {
  readonly scope: string;
  readonly key: string;
  readonly method: string;
  readonly paramsHash: string;
  readonly outcome: IdempotencyOutcome;
  readonly expiresAt: number;
}

type PendingEntry = {
  readonly method: string;
  readonly paramsHash: string;
  readonly outcome: Promise<IdempotencyOutcome>;
};

export class MemoryIdempotencyStore implements IdempotencyStorePort {
  readonly #entries = new Map<string, IdempotencyEntry>();
  readonly #pending = new Map<string, PendingEntry>();

  constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly maxEntries = 1_000,
    private readonly now = () => Date.now(),
  ) {}

  async execute(
    scope: string,
    key: string,
    method: string,
    params: unknown,
    operation: () => Promise<IdempotencyOutcome>,
  ): Promise<IdempotencyExecution> {
    this.prune();
    const cacheKey = this.cacheKey(scope, key);
    const paramsHash = hashParams(params);
    const entry = this.#entries.get(cacheKey);
    if (entry && entry.expiresAt > this.now()) {
      if (entry.method !== method || entry.paramsHash !== paramsHash)
        return { status: "conflict" };
      return { status: "replayed", outcome: entry.outcome };
    }
    const pending = this.#pending.get(cacheKey);
    if (pending) {
      if (pending.method !== method || pending.paramsHash !== paramsHash)
        return { status: "conflict" };
      return { status: "replayed", outcome: await pending.outcome };
    }

    const outcomePromise = operation();
    this.#pending.set(cacheKey, {
      method,
      paramsHash,
      outcome: outcomePromise,
    });
    try {
      const outcome = await outcomePromise;
      this.#entries.set(cacheKey, {
        scope,
        key,
        method,
        paramsHash,
        outcome,
        expiresAt: this.now() + this.ttlMs,
      });
      this.prune();
      return { status: "executed", outcome };
    } finally {
      this.#pending.delete(cacheKey);
    }
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
    while (this.#entries.size > this.maxEntries) {
      const first = this.#entries.keys().next().value;
      if (!first) break;
      this.#entries.delete(first);
    }
  }

  private cacheKey(scope: string, key: string): string {
    return `${scope}:${key}`;
  }
}

export function hashParams(params: unknown): string {
  const input = stableStringify(params);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(",")}}`;
}
