import type {
  IdempotencyExecution,
  IdempotencyOutcome,
  IdempotencyStorePort,
} from "@nervekit/protocol/rpc";
import { hashParams } from "@nervekit/protocol/rpc";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/index.js";
import { redactProtocolValue } from "./protocol-errors.js";

const MAX_RECORD_BYTES = 256 * 1024;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 1_000;
const MAX_OBJECT_KEYS = 1_000;
const MAX_STRING_BYTES = 64 * 1024;
const SECRET_KEY_PATTERN =
  /authorization|cookie|token|apikey|api_key|password|passwd|secret|credential|private_key|private-key/i;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^/\s:@]+:[^/\s@]+@/i;

/** Bounded SQLite idempotency outcomes shared by HTTP and WebSocket RPC. */
export class SqliteIdempotencyStore implements IdempotencyStorePort {
  #lock: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: CanonicalStore,
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
      const now = this.now();
      const existing = await this.store.readRpcIdempotency<IdempotencyOutcome>(
        scope,
        key,
        now,
      );
      if (existing) {
        if (existing.method !== method || existing.paramsHash !== paramsHash)
          return { status: "conflict" };
        return { status: "replayed", outcome: existing.outcome };
      }

      let outcome = safeOutcome(await operation());
      const createdAt = this.now();
      const entry = {
        scope,
        key,
        method,
        paramsHash,
        outcome,
        expiresAt: createdAt + this.ttlMs,
        createdAt,
      };
      if (Buffer.byteLength(JSON.stringify(entry)) > MAX_RECORD_BYTES) {
        outcome = unsafeOutcome();
        entry.outcome = outcome;
      }
      await this.store.writeRpcIdempotency(entry, this.maxEntries, createdAt);
      return { status: "executed", outcome };
    });
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
