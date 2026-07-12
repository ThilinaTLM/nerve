import { protocolErrorDataSchema } from "@nervekit/contracts";
import type {
  IdempotencyExecution,
  IdempotencyOutcome,
  IdempotencyStorePort,
} from "@nervekit/protocol";
import { JsonlStore } from "./jsonl-store.js";
import { sandboxSha256Digest } from "./hash.js";

type DurableIdempotencyRecord = {
  scope: string;
  key: string;
  method: string;
  paramsDigest: string;
  outcome: IdempotencyOutcome;
  storedAt: string;
};

type DurableIdempotencyConflict = {
  scope: string;
  key: string;
  existingMethod: string;
  attemptedMethod: string;
  existingParamsDigest: string;
  attemptedParamsDigest: string;
  detectedAt: string;
};

type PendingRecord = {
  method: string;
  paramsDigest: string;
  outcome: Promise<IdempotencyOutcome>;
};

export class FileRpcIdempotencyStore implements IdempotencyStorePort {
  readonly #records: JsonlStore<DurableIdempotencyRecord>;
  readonly #conflicts: JsonlStore<DurableIdempotencyConflict>;
  readonly #index = new Map<string, DurableIdempotencyRecord>();
  readonly #pending = new Map<string, PendingRecord>();

  constructor(recordsPath: string, conflictsPath: string) {
    this.#records = new JsonlStore(recordsPath, {
      parse: parseIdempotencyRecord,
    });
    this.#conflicts = new JsonlStore(conflictsPath, {
      parse: parseIdempotencyConflict,
    });
  }

  async load(): Promise<void> {
    this.#index.clear();
    for (const record of await this.#records.readAll()) {
      this.#index.set(cacheKey(record.scope, record.key), record);
    }
  }

  async execute(
    scope: string,
    key: string,
    method: string,
    params: unknown,
    operation: () => Promise<IdempotencyOutcome>,
  ): Promise<IdempotencyExecution> {
    const indexKey = cacheKey(scope, key);
    const paramsDigest = sandboxSha256Digest(params);
    const stored = this.#index.get(indexKey);
    if (stored) {
      if (stored.method !== method || stored.paramsDigest !== paramsDigest) {
        await this.recordConflict(stored, method, paramsDigest);
        return { status: "conflict" };
      }
      return { status: "replayed", outcome: stored.outcome };
    }

    const pending = this.#pending.get(indexKey);
    if (pending) {
      if (pending.method !== method || pending.paramsDigest !== paramsDigest) {
        await this.#conflicts.append({
          scope,
          key,
          existingMethod: pending.method,
          attemptedMethod: method,
          existingParamsDigest: pending.paramsDigest,
          attemptedParamsDigest: paramsDigest,
          detectedAt: new Date().toISOString(),
        });
        return { status: "conflict" };
      }
      return { status: "replayed", outcome: await pending.outcome };
    }

    const outcomePromise = operation();
    this.#pending.set(indexKey, {
      method,
      paramsDigest,
      outcome: outcomePromise,
    });
    try {
      const outcome = await outcomePromise;
      const record: DurableIdempotencyRecord = {
        scope,
        key,
        method,
        paramsDigest,
        outcome,
        storedAt: new Date().toISOString(),
      };
      await this.#records.append(record);
      this.#index.set(indexKey, record);
      return { status: "executed", outcome };
    } finally {
      this.#pending.delete(indexKey);
    }
  }

  private async recordConflict(
    stored: DurableIdempotencyRecord,
    attemptedMethod: string,
    attemptedParamsDigest: string,
  ): Promise<void> {
    await this.#conflicts.append({
      scope: stored.scope,
      key: stored.key,
      existingMethod: stored.method,
      attemptedMethod,
      existingParamsDigest: stored.paramsDigest,
      attemptedParamsDigest,
      detectedAt: new Date().toISOString(),
    });
  }
}

function cacheKey(scope: string, key: string): string {
  return `${scope}\u0000${key}`;
}

function parseIdempotencyRecord(value: unknown): DurableIdempotencyRecord {
  const record = asObject(value, "idempotency record");
  const outcome = asObject(record.outcome, "idempotency outcome");
  if (outcome.status === "success") {
    return {
      scope: asString(record.scope, "scope"),
      key: asString(record.key, "key"),
      method: asString(record.method, "method"),
      paramsDigest: asDigest(record.paramsDigest),
      outcome: { status: "success", result: outcome.result },
      storedAt: asDate(record.storedAt, "storedAt"),
    };
  }
  if (outcome.status === "error") {
    const error = asObject(outcome.error, "idempotency error");
    return {
      scope: asString(record.scope, "scope"),
      key: asString(record.key, "key"),
      method: asString(record.method, "method"),
      paramsDigest: asDigest(record.paramsDigest),
      outcome: {
        status: "error",
        error: protocolErrorDataSchema.parse({
          code: asString(error.code, "error.code"),
          message: asString(error.message, "error.message").slice(0, 2_000),
          retryable: Boolean(error.retryable),
        }),
      },
      storedAt: asDate(record.storedAt, "storedAt"),
    };
  }
  throw new Error("Invalid idempotency outcome status");
}

function parseIdempotencyConflict(value: unknown): DurableIdempotencyConflict {
  const record = asObject(value, "idempotency conflict");
  return {
    scope: asString(record.scope, "scope"),
    key: asString(record.key, "key"),
    existingMethod: asString(record.existingMethod, "existingMethod"),
    attemptedMethod: asString(record.attemptedMethod, "attemptedMethod"),
    existingParamsDigest: asDigest(record.existingParamsDigest),
    attemptedParamsDigest: asDigest(record.attemptedParamsDigest),
    detectedAt: asDate(record.detectedAt, "detectedAt"),
  };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${label}`);
  return value;
}

function asDigest(value: unknown): string {
  const digest = asString(value, "paramsDigest");
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new Error("Invalid paramsDigest");
  return digest;
}

function asDate(value: unknown, label: string): string {
  const date = asString(value, label);
  if (Number.isNaN(Date.parse(date))) throw new Error(`Invalid ${label}`);
  return date;
}
