import { createHash } from "node:crypto";
import type { NerveMessage } from "@nervekit/shared";

export interface IdempotencyEntry {
  scope: string;
  key: string;
  method: string;
  paramsHash: string;
  message: NerveMessage;
  expiresAt: number;
}

export class IdempotencyStore {
  #entries = new Map<string, IdempotencyEntry>();

  constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly maxEntries = 1_000,
  ) {}

  lookup(
    scope: string,
    key: string,
    method: string,
    params: unknown,
  ):
    | { status: "miss" }
    | { status: "hit"; message: NerveMessage }
    | { status: "conflict" } {
    this.prune();
    const entry = this.#entries.get(this.cacheKey(scope, key));
    if (!entry || entry.expiresAt <= Date.now()) return { status: "miss" };
    if (entry.method !== method || entry.paramsHash !== hashParams(params)) {
      return { status: "conflict" };
    }
    return { status: "hit", message: entry.message };
  }

  store(
    scope: string,
    key: string,
    method: string,
    params: unknown,
    message: NerveMessage,
  ): void {
    this.prune();
    this.#entries.set(this.cacheKey(scope, key), {
      scope,
      key,
      method,
      paramsHash: hashParams(params),
      message,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  private prune(): void {
    const now = Date.now();
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
  return createHash("sha256").update(stableStringify(params)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(",")}}`;
}
