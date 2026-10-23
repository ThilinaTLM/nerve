import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  atomicReplaceFile,
  withFileMutation,
} from "../../storage-bootstrap/file-mutations.js";
import {
  errorCode,
  synchronizeDirectory,
  type DirectoryDurability,
} from "./durable-write.js";

export type SourceDigest = string | "missing";
export interface SchemaDocument {
  schemaVersion: number;
  revision?: number;
}
export interface RevisionedDocument extends SchemaDocument {
  revision: number;
}
export interface DocumentIssue {
  code:
    | "missing-required"
    | "malformed-json"
    | "unknown-field"
    | "future-version"
    | "invalid-value"
    | "io-error"
    | "publication-failed";
  pointer: string;
}
export interface ScopeGeneration<S, D> {
  readonly scope: S;
  readonly path: string;
  readonly generation: number;
  readonly revision: number;
  readonly digest: SourceDigest;
  readonly document: Readonly<D>;
}
export type ScopeHealth<S, D> =
  | {
      readonly status: "ready" | "missing-optional";
      readonly value: ScopeGeneration<S, D>;
    }
  | {
      readonly status: "unavailable";
      readonly scope: S;
      readonly path: string;
      readonly generation: number;
      readonly schemaVersion?: number;
      readonly issues: readonly DocumentIssue[];
      readonly retained?: ScopeGeneration<S, D>;
    };

export interface ScopedDocumentOptions<S, D extends SchemaDocument> {
  /** Must return a stable identity/path for each document, including its domain. */
  resolvePath(scope: S): string;
  required(scope: S): boolean;
  supportedVersion: number;
  /** False for profile definitions, which use exact-byte identity without persisted revisions. */
  revisioned?: boolean;
  /** Strict domain parser; must not strip unknown properties or insert sparse defaults. */
  parse(input: unknown, scope: S): D;
  /** Only used for an absent optional document; must have revision zero. Never persisted on read. */
  empty(scope: S): D;
  /** Translate domain parser errors to redacted diagnostics; never include source values. */
  issues(error: unknown): readonly DocumentIssue[];
  /** Domain owner decides whether old non-security memory may be exposed explicitly. */
  retainOnInvalid?: boolean;
  /** Synchronous publication of one complete immutable generation. Throwing blocks the scope. */
  publish?(value: ScopeGeneration<S, D>): void;
  /** Test/host IO ports. The default writer uses the existing serialized atomic primitive. */
  write?: typeof atomicReplaceFile;
  syncDirectory?: typeof synchronizeDirectory;
}

export class ScopeConflictError extends Error {
  constructor() {
    super("Scoped configuration changed; reload before saving");
  }
}
export class ScopeUnavailableError extends Error {
  constructor() {
    super("Scoped configuration is unavailable; authoritative reload required");
  }
}

/** No constructor IO, directory enumeration, watchers, or polling. One instance per domain. */
export class ScopedDocumentStore<S, D extends SchemaDocument> {
  private readonly states = new Map<string, ScopeHealth<S, D>>();
  private readonly epochs = new Map<string, number>();
  private readonly dependents = new Map<string, Set<() => void>>();

  constructor(private readonly options: ScopedDocumentOptions<S, D>) {}

  peek(scope: S): ScopeHealth<S, D> | undefined {
    return this.states.get(this.key(scope));
  }

  ensureLoaded(scope: S): Promise<ScopeHealth<S, D>> {
    return this.serialize(
      scope,
      async () => this.peek(scope) ?? this.load(scope),
    );
  }

  /** Explicit recovery only. Ordinary resolution never rereads an already loaded scope. */
  reload(scope: S): Promise<ScopeHealth<S, D>> {
    return this.serialize(scope, () => this.load(scope));
  }

  /** Register only loaded dependents, selecting preference/security dependencies at the owning layer. */
  onInvalidate(scope: S, invalidate: () => void): () => void {
    const key = this.key(scope);
    const listeners = this.dependents.get(key) ?? new Set();
    listeners.add(invalidate);
    this.dependents.set(key, listeners);
    return () => {
      listeners.delete(invalidate);
      if (listeners.size === 0) this.dependents.delete(key);
    };
  }

  /** Capture after ensureLoaded; verify synchronously before publishing async derived work. */
  captureGenerations(scopes: readonly S[]): () => boolean {
    const vector = scopes.map((scope) => {
      const key = this.key(scope);
      if (!this.states.has(key)) throw new ScopeUnavailableError();
      return [key, this.epochs.get(key)] as const;
    });
    return () =>
      vector.every(
        ([key, epoch]) =>
          this.epochs.get(key) === epoch &&
          this.states.get(key)?.status !== "unavailable",
      );
  }

  /**
   * Low-level validated transaction, not a public arbitrary-patch API. The domain owner
   * enforces editable merge units, resets, profile receipts and resolved constraints here.
   * No writes/side effects may occur in change; it runs inside mutation serialization.
   */
  save(
    scope: S,
    expected: { revision: number; digest: SourceDigest },
    change: (document: Readonly<D>) => unknown | Promise<unknown>,
  ): Promise<{
    value: ScopeGeneration<S, D>;
    durability: DirectoryDurability;
  }> {
    return this.serialize(scope, async () => {
      const state = this.peek(scope) ?? (await this.load(scope));
      if (state.status === "unavailable") throw new ScopeUnavailableError();
      const current = state.value;
      if (
        current.revision !== expected.revision ||
        current.digest !== expected.digest
      )
        throw new ScopeConflictError();
      let candidate: D | undefined;
      let bytes: string | undefined;
      // prepare executes under the primitive's real target-file lock, before temp creation.
      await (this.options.write ?? atomicReplaceFile)(
        current.path,
        async (handle) => {
          if (bytes === undefined)
            throw new Error("Writer did not prepare document");
          await handle.writeFile(bytes);
        },
        {
          mode: 0o600,
          prepare: async () => {
            if ((await sourceDigest(current.path)) !== expected.digest)
              throw new ScopeConflictError();
            const input = await change(current.document);
            if (typeof input !== "object" || input === null)
              throw new Error("Expected document object");
            candidate = this.parse(
              this.options.revisioned === false
                ? input
                : { ...input, revision: current.revision + 1 },
              scope,
            );
            if (
              this.options.revisioned !== false &&
              (candidate.revision !== current.revision + 1 ||
                !Number.isSafeInteger(candidate.revision))
            )
              throw new Error("Invalid document revision");
            bytes = `${JSON.stringify(candidate, null, 2)}\n`;
            return undefined;
          },
        },
      );
      if (!candidate || bytes === undefined)
        throw new Error("Writer did not prepare document");
      return this.commit(scope, candidate, bytes);
    });
  }

  /** Explicit creation only: never an automatic fallback for a missing required document. */
  create(
    scope: S,
    input: unknown,
  ): Promise<{
    value: ScopeGeneration<S, D>;
    durability: DirectoryDurability;
  }> {
    return this.serialize(scope, async () => {
      let candidate: D | undefined;
      let bytes: string | undefined;
      await (this.options.write ?? atomicReplaceFile)(
        this.key(scope),
        async (handle) => {
          if (bytes === undefined)
            throw new Error("Writer did not prepare document");
          await handle.writeFile(bytes);
        },
        {
          mode: 0o600,
          prepare: async () => {
            if ((await sourceDigest(this.key(scope))) !== "missing")
              throw new ScopeConflictError();
            candidate = this.parse(input, scope);
            if (this.options.revisioned !== false && candidate.revision !== 1)
              throw new Error("Created document must have revision one");
            bytes = `${JSON.stringify(candidate, null, 2)}\n`;
            return undefined;
          },
        },
      );
      if (!candidate || bytes === undefined)
        throw new Error("Writer did not prepare document");
      return this.commit(scope, candidate, bytes);
    });
  }

  private async commit(
    scope: S,
    candidate: D,
    bytes: string,
  ): Promise<{
    value: ScopeGeneration<S, D>;
    durability: DirectoryDurability;
  }> {
    // No stale execution while directory durability/publication is pending.
    this.unavailable(scope, [{ code: "publication-failed", pointer: "" }]);
    try {
      const durability = await (
        this.options.syncDirectory ?? synchronizeDirectory
      )(this.key(scope));
      const value = this.activate(
        scope,
        candidate,
        digestBytes(bytes),
        "ready",
      );
      return { value, durability };
    } catch (error) {
      this.unavailable(scope, [{ code: "publication-failed", pointer: "" }]);
      throw error;
    }
  }

  private key(scope: S): string {
    return path.resolve(this.options.resolvePath(scope));
  }

  private serialize<T>(scope: S, operation: () => Promise<T>): Promise<T> {
    // Queue key only, never created on disk. Keep publication/reload serialized too,
    // without recursively taking the atomic primitive's target lock.
    return withFileMutation(
      `${this.key(scope)}.scoped-publication-lock`,
      operation,
    );
  }

  private parse(input: unknown, scope: S): D {
    if (
      typeof input === "object" &&
      input !== null &&
      "schemaVersion" in input &&
      typeof input.schemaVersion === "number" &&
      Number.isInteger(input.schemaVersion) &&
      input.schemaVersion > this.options.supportedVersion
    ) {
      throw new FutureVersionError();
    }
    return this.options.parse(input, scope);
  }

  private async load(scope: S): Promise<ScopeHealth<S, D>> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.key(scope));
    } catch (error) {
      if (errorCode(error) !== "ENOENT")
        return this.unavailable(scope, [{ code: "io-error", pointer: "" }]);
      if (this.options.required(scope))
        return this.unavailable(scope, [
          { code: "missing-required", pointer: "" },
        ]);
      try {
        const empty = this.parse(this.options.empty(scope), scope);
        if (empty.revision !== 0)
          throw new Error("Missing document must have revision zero", {
            cause: error,
          });
        this.activate(scope, empty, "missing", "missing-optional");
      } catch {
        return this.unavailable(scope, [
          { code: "publication-failed", pointer: "" },
        ]);
      }
      return this.states.get(this.key(scope))!;
    }
    let input: unknown;
    try {
      input = JSON.parse(bytes.toString("utf8"));
    } catch {
      return this.unavailable(scope, [{ code: "malformed-json", pointer: "" }]);
    }
    let document: D;
    try {
      document = this.parse(input, scope);
    } catch (error) {
      const version =
        typeof input === "object" &&
        input !== null &&
        "schemaVersion" in input &&
        typeof input.schemaVersion === "number"
          ? input.schemaVersion
          : undefined;
      return this.unavailable(
        scope,
        error instanceof FutureVersionError
          ? [{ code: "future-version", pointer: "/schemaVersion" }]
          : this.options.issues(error),
        version,
      );
    }
    try {
      this.activate(scope, document, digestBytes(bytes), "ready");
    } catch {
      return this.unavailable(scope, [
        { code: "publication-failed", pointer: "" },
      ]);
    }
    return this.states.get(this.key(scope))!;
  }

  private next(scope: S): number {
    const key = this.key(scope);
    const next = (this.epochs.get(key) ?? 0) + 1;
    this.epochs.set(key, next);
    return next;
  }

  private activate(
    scope: S,
    document: D,
    digest: SourceDigest,
    status: "ready" | "missing-optional",
  ): ScopeGeneration<S, D> {
    const value = freezeJson({
      scope: structuredClone(scope),
      path: this.key(scope),
      generation: this.next(scope),
      revision: document.revision ?? 0,
      digest,
      document: structuredClone(document),
    });
    this.options.publish?.(value);
    this.states.set(this.key(scope), Object.freeze({ status, value }));
    this.invalidate(scope);
    return value;
  }

  private unavailable(
    scope: S,
    issues: readonly DocumentIssue[],
    schemaVersion?: number,
  ): ScopeHealth<S, D> {
    const previous = this.peek(scope);
    const retained =
      this.options.retainOnInvalid &&
      !issues.some((issue) => issue.code === "publication-failed")
        ? previous?.status === "unavailable"
          ? previous.retained
          : previous?.value
        : undefined;
    const state: ScopeHealth<S, D> = freezeJson({
      status: "unavailable",
      scope: structuredClone(scope),
      path: this.key(scope),
      generation: this.next(scope),
      issues: structuredClone(issues),
      ...(schemaVersion === undefined ? {} : { schemaVersion }),
      ...(retained ? { retained } : {}),
    });
    this.states.set(this.key(scope), state);
    // Best effort notifications cannot make an unavailable scope usable again.
    try {
      this.invalidate(scope);
    } catch {
      /* All listeners have already been invoked. */
    }
    return state;
  }

  private invalidate(scope: S): void {
    const errors: unknown[] = [];
    for (const invalidate of this.dependents.get(this.key(scope)) ?? []) {
      try {
        invalidate();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Dependent invalidation failed");
  }
}

class FutureVersionError extends Error {}
export function digestBytes(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
async function sourceDigest(filePath: string): Promise<SourceDigest> {
  try {
    return digestBytes(await readFile(filePath));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "missing";
    throw error;
  }
}
export function freezeJson<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}
