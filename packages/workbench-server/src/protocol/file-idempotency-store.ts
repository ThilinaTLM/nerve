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

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 1_000;
const MAX_OBJECT_KEYS = 1_000;
const MAX_STRING_BYTES = 64 * 1024;
const SECRET_KEY_PATTERN =
  /authorization|cookie|token|apikey|api_key|password|passwd|secret|credential|private_key|private-key/i;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^/\s:@]+:[^/\s@]+@/i;

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

      const resolved = safeOutcome(await operation());
      const entry = {
        scope,
        key,
        method,
        paramsHash,
        outcome: resolved,
        expiresAt: this.now() + this.ttlMs,
      };
      if (Buffer.byteLength(JSON.stringify(entry)) > MAX_RECORD_BYTES)
        entry.outcome = unsafeOutcome();
      this.#entries?.push(entry);
      this.#prune();
      await this.#persist();
      return { status: "executed", outcome: entry.outcome };
    });
  }

  async #load(): Promise<void> {
    if (this.#entries) return;
    try {
      const text = await readFile(this.path, "utf8");
      if (Buffer.byteLength(text) > MAX_FILE_BYTES)
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
    while (
      (this.#entries?.length ?? 0) > 1 &&
      Buffer.byteLength(
        JSON.stringify({ version: 1, entries: this.#entries }),
      ) > MAX_FILE_BYTES
    )
      this.#entries?.shift();
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

function unsafeOutcome(): IdempotencyOutcome {
  return {
    status: "error",
    error: {
      code: "INTERNAL_ERROR",
      message: "Operation result could not be persisted safely",
      retryable: false,
    },
  };
}

function safeJson(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
): unknown {
  if (depth > MAX_DEPTH) throw new Error("maximum depth exceeded");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (
      Buffer.byteLength(value) > MAX_STRING_BYTES ||
      CREDENTIAL_URL_PATTERN.test(value)
    )
      throw new Error("unsafe string");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return value;
  }
  if (typeof value !== "object" || value instanceof Uint8Array)
    throw new Error("non-JSON value");
  if (seen.has(value)) throw new Error("cyclic value");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) throw new Error("array too large");
      return value.map((child) => safeJson(child, depth + 1, seen));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype)
      throw new Error("non-plain object");
    const entries = Object.entries(value);
    if (entries.length > MAX_OBJECT_KEYS) throw new Error("object too large");
    const output: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      if (SECRET_KEY_PATTERN.test(key)) throw new Error("secret-like key");
      output[key] = safeJson(child, depth + 1, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function safeOutcome(outcome: IdempotencyOutcome): IdempotencyOutcome {
  if (outcome.status === "success") {
    try {
      return { status: "success", result: safeJson(outcome.result) };
    } catch {
      return unsafeOutcome();
    }
  }
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
