import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  IdempotencyExecution,
  IdempotencyOutcome,
  IdempotencyStorePort,
} from "@nervekit/protocol";
import { hashParams } from "@nervekit/protocol";
import { z } from "zod";
import { atomicWriteJson } from "../infrastructure/storage/json.js";
import { redactProtocolValue } from "./protocol-errors.js";

const errorSchema = z.object({
  code: z.string().max(64),
  message: z.string().max(512),
  retryable: z.boolean(),
  close: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  recovery: z.unknown().optional(),
});
const entrySchema = z.object({
  scope: z.string().max(256),
  key: z.string().max(256),
  method: z.string().max(256),
  paramsHash: z.string().max(128),
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("success"), result: z.unknown() }),
    z.object({ status: z.literal("error"), error: errorSchema }),
  ]),
  expiresAt: z.number().int().nonnegative(),
});
const fileSchema = z.object({
  version: z.literal(1),
  entries: z.array(entrySchema).max(1_000),
});
type StoredEntry = z.infer<typeof entrySchema>;

/** File-first, bounded idempotency outcomes shared by HTTP and WebSocket RPC. */
export class FileIdempotencyStore implements IdempotencyStorePort {
  #entries: StoredEntry[] | undefined;
  #lock: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
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
    const paramsHash = hashParams(params);
    return this.#withLock(async () => {
      await this.#load();
      this.#prune();
      const existing = this.#entries?.find(
        (entry) => entry.scope === scope && entry.key === key,
      );
      if (existing) {
        if (existing.method !== method || existing.paramsHash !== paramsHash)
          return { status: "conflict" };
        return {
          status: "replayed",
          outcome: existing.outcome as IdempotencyOutcome,
        };
      }

      const resolved = await operation();
      this.#entries?.push({
        scope,
        key,
        method,
        paramsHash,
        outcome: safeOutcome(resolved),
        expiresAt: this.now() + this.ttlMs,
      });
      this.#prune();
      await this.#persist();
      return { status: "executed", outcome: resolved };
    });
  }

  async #load(): Promise<void> {
    if (this.#entries) return;
    try {
      const text = await readFile(this.path, "utf8");
      if (Buffer.byteLength(text) > 4 * 1024 * 1024)
        throw new Error("oversized");
      this.#entries = fileSchema.parse(JSON.parse(text)).entries;
    } catch (error) {
      this.#entries = [];
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        await rename(this.path, `${this.path}.corrupt`).catch(() => undefined);
    }
  }

  #prune(): void {
    const now = this.now();
    this.#entries = (this.#entries ?? []).filter(
      (entry) => entry.expiresAt > now,
    );
    if (this.#entries.length > this.maxEntries)
      this.#entries = this.#entries.slice(-this.maxEntries);
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await atomicWriteJson(
      this.path,
      { version: 1, entries: this.#entries },
      0o600,
    );
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#lock;
    let release!: () => void;
    this.#lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function safeOutcome(outcome: IdempotencyOutcome): IdempotencyOutcome {
  if (outcome.status === "success") return outcome;
  return {
    status: "error",
    error: {
      ...outcome.error,
      message: outcome.error.message.slice(0, 512),
      details: outcome.error.details
        ? (redactProtocolValue(outcome.error.details) as Record<
            string,
            unknown
          >)
        : undefined,
    },
  };
}
