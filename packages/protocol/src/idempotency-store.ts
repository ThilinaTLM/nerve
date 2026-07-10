import type { IdempotencyLookup, IdempotencyStorePort } from "./rpc.js";

export interface IdempotencyEntry {
  readonly scope: string;
  readonly key: string;
  readonly method: string;
  readonly paramsHash: string;
  readonly result: unknown;
  readonly expiresAt: number;
}

export class MemoryIdempotencyStore implements IdempotencyStorePort {
  readonly #entries = new Map<string, IdempotencyEntry>();

  constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly maxEntries = 1_000,
    private readonly now = () => Date.now(),
  ) {}

  lookup(
    scope: string,
    key: string,
    method: string,
    params: unknown,
  ): IdempotencyLookup {
    this.prune();
    const entry = this.#entries.get(this.cacheKey(scope, key));
    if (!entry || entry.expiresAt <= this.now()) return { status: "miss" };
    if (entry.method !== method || entry.paramsHash !== hashParams(params)) {
      return { status: "conflict" };
    }
    return { status: "hit", result: entry.result };
  }

  store(
    scope: string,
    key: string,
    method: string,
    params: unknown,
    result: unknown,
  ): void {
    this.prune();
    this.#entries.set(this.cacheKey(scope, key), {
      scope,
      key,
      method,
      paramsHash: hashParams(params),
      result,
      expiresAt: this.now() + this.ttlMs,
    });
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
