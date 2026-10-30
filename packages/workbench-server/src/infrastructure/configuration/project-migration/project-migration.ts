import {
  digest,
  bytes,
  projectPath,
  homePath,
  quarantine,
  decodeConfiguration,
  legacyVersion,
} from "./project-migration-files.js";
import {
  ProjectInputError,
  NewerLegacyVersion,
} from "./project-input-error.js";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  ProjectConfigurationHealth,
  ProjectConfigurationIssue,
  ResolveProjectConfiguration,
} from "@nervekit/contracts/projects";
import { ApplicationError } from "../../../core/application-error.js";
import { atomicWriteFile } from "../../storage-bootstrap/file-mutations.js";
import type { TrustedResourceKind } from "@nervekit/contracts/core";
import { atomicWriteJson } from "../../storage-bootstrap/json.js";

export interface ProjectLegacyInput {
  root?: "project" | "home";
  path: string;
  currentVersion: number;
  version?: { field: string; absent: number };
  decode?(bytes: string): unknown;
  trustKind?: TrustedResourceKind;
  select?(value: unknown): boolean;
}
export interface ProjectLegacySource extends Omit<ProjectLegacyInput, "path"> {
  root?: "project" | "home";
  path: string | ((context: ProjectConfigurationContext) => string);
  /** A catalog entry absent from a valid catalog is not an invalid override. */
  select?(value: unknown): boolean;
  shared?: boolean;
  inputs?:
    | readonly ProjectLegacyInput[]
    | ((value: unknown) => readonly ProjectLegacyInput[]);
  migrate(value: unknown, inputs: Readonly<Record<string, unknown>>): unknown;
}
export interface ProjectConfigurationType<T> {
  readonly id: string;
  readonly label: string;
  readonly resetDescription: string;
  readonly fallbackDescription?: string;
  /** Relative to the project's .nerve directory. */
  readonly path: string;
  readonly currentVersion: number;
  readonly version: { field: string; absent: number };
  /** Frozen local schemas and pure N -> N+1 conversions belong to the type. */
  readonly migrators: Readonly<Record<number, (value: unknown) => unknown>>;
  readonly legacySources?: readonly ProjectLegacySource[];
  readonly trustKind?: TrustedResourceKind;
  readonly migrationDependencies?: readonly ProjectConfigurationType<unknown>[];
  readonly decode?: (bytes: string) => unknown;
  encode?(value: T): string;
  readonly schema: { parse(value: unknown): T };
  fallback(): T;
  /** null removes an override; a value replaces it with validated defaults. */
  reset(): T | null;
}
export interface ProjectConfigurationContext {
  projectId: string;
  directory: string;
}
export interface ProjectMigrationTrust {
  revoke?(input: {
    type: string;
    projectId: string;
    paths: string[];
  }): Promise<void>;
  /** Return a closure only if the exact original bytes are trusted. The closure
   * must recheck that binding before carrying trust to the written bytes. */
  capture(input: {
    type: string;
    projectId: string;
    path: string;
    source: Buffer;
    targetKind?: TrustedResourceKind;
    sources?: readonly {
      path: string;
      source: Buffer;
      kind?: TrustedResourceKind;
    }[];
  }): Promise<((path: string, bytes: Buffer) => Promise<void>) | undefined>;
}
export interface ProjectConfigurationResult<T> {
  value: T;
  classification: "healthy" | "migrated" | "corrupted" | "incompatible";
  path: string;
  sourceDigest?: string;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
/** Lazy, per-resource migration. This service never scans projects or watches files. */
export class ProjectMigrationService {
  private readonly resolvedListeners = new Set<
    (
      context: ProjectConfigurationContext,
      type: ProjectConfigurationType<unknown>,
    ) => Promise<void>
  >();
  onResolved(
    listener: (
      context: ProjectConfigurationContext,
      type: ProjectConfigurationType<unknown>,
    ) => Promise<void>,
  ): () => void {
    this.resolvedListeners.add(listener);
    return () => this.resolvedListeners.delete(listener);
  }
  private readonly healthListeners = new Set<
    (health: ProjectConfigurationHealth) => void
  >();
  onHealthChanged(
    listener: (health: ProjectConfigurationHealth) => void,
  ): () => void {
    this.healthListeners.add(listener);
    return () => this.healthListeners.delete(listener);
  }
  private publishHealth(health: ProjectConfigurationHealth): void {
    this.options.changed?.(health);
    for (const listener of this.healthListeners) listener(health);
  }
  private readonly types = new Map<string, ProjectConfigurationType<unknown>>();
  private readonly issues = new Map<string, ProjectConfigurationIssue>();
  constructor(
    private readonly options: {
      home: string;
      trust?: ProjectMigrationTrust;
      changed?(health: ProjectConfigurationHealth): void;
      write?: typeof atomicWriteJson;
    },
  ) {}

  register<T>(type: ProjectConfigurationType<T>): void {
    const registered = this.types.get(type.id);
    if (registered && registered !== type)
      throw new Error(`Duplicate project configuration type: ${type.id}`);
    this.types.set(type.id, type);
  }
  async resolve(
    context: ProjectConfigurationContext,
    request: ResolveProjectConfiguration,
  ): Promise<ProjectConfigurationHealth> {
    const type = this.types.get(request.type);
    if (!type)
      throw new Error(`Unknown project configuration type: ${request.type}`);
    if (request.action === "reset")
      await this.reset(context, type, request.confirmed);
    else await this.reload(context, type);
    for (const listener of this.resolvedListeners)
      await listener(context, type);
    return this.health(context.projectId);
  }
  health(projectId: string): ProjectConfigurationHealth {
    return {
      projectId,
      issues: [...this.issues.values()].filter(
        (issue) => issue.projectId === projectId,
      ),
    };
  }
  private record<T>(
    context: ProjectConfigurationContext,
    type: ProjectConfigurationType<T>,
    path: string,
    classification: ProjectConfigurationResult<T>["classification"],
    reason?: string,
    resetAllowed = true,
  ): void {
    path = resolve(path);
    const key = JSON.stringify([context.projectId, type.id, path]);
    const previous = this.issues.get(key);
    let removedOther = false;
    for (const [otherKey, issue] of this.issues)
      if (
        otherKey !== key &&
        issue.projectId === context.projectId &&
        issue.type === type.id
      ) {
        this.issues.delete(otherKey);
        removedOther = true;
      }
    // Keep the successful-migration activity item until explicitly reloaded.
    if (classification === "healthy" && previous?.classification === "migrated")
      return;
    if (classification === "healthy") this.issues.delete(key);
    else
      this.issues.set(key, {
        projectId: context.projectId,
        type: type.id,
        label: type.label,
        resetDescription: type.resetDescription,
        path,
        classification,
        message:
          (reason ??
            (classification === "migrated"
              ? "Project configuration was upgraded."
              : "Project configuration is invalid.")) +
          (classification !== "migrated" && type.fallbackDescription
            ? ` ${type.fallbackDescription}`
            : ""),
        resetOffered: classification === "corrupted" && resetAllowed,
      });
    if (
      removedOther ||
      JSON.stringify(previous) !== JSON.stringify(this.issues.get(key))
    )
      this.publishHealth(this.health(context.projectId));
  }
  async load<T>(
    context: ProjectConfigurationContext,
    type: ProjectConfigurationType<T>,
    ancestors: readonly string[] = [],
  ): Promise<ProjectConfigurationResult<T>> {
    let path = resolve(context.directory, ".nerve", type.path);
    try {
      path = await projectPath(context.directory, type.path);
    } catch (error) {
      this.record(context, type, path, "corrupted", message(error), false);
      return { path, classification: "corrupted", value: type.fallback() };
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      let sourcePath = path;
      let source: Buffer | undefined;
      let legacy:
        | NonNullable<ProjectConfigurationType<T>["legacySources"]>[number]
        | undefined;
      try {
        source = await bytes(path);
        const snapshots: {
          path: string;
          source: Buffer;
          missing?: boolean;
          kind?: TrustedResourceKind;
        }[] = [];
        const inputs: Record<string, unknown> = {};
        if (!source) {
          const suppressed = await this.suppressed(context, type);
          for (const candidate of type.legacySources ?? []) {
            const candidatePath = await this.legacyPath(context, candidate);
            const candidateBytes = await bytes(candidatePath);
            if (candidateBytes === undefined) {
              snapshots.push({
                path: candidatePath,
                source: Buffer.alloc(0),
                missing: true,
              });
              continue;
            }
            if (suppressed[candidatePath] === digest(candidateBytes)) {
              snapshots.push({ path: candidatePath, source: candidateBytes });
              continue;
            }
            sourcePath = candidatePath;
            source = candidateBytes;
            const decoded = legacyVersion(
              decodeConfiguration(candidateBytes, candidate.decode),
              candidate,
              type.version,
            );
            if (candidate.select && !candidate.select(decoded)) {
              snapshots.push({ path: candidatePath, source: candidateBytes });
              source = undefined;
              continue;
            }
            legacy = candidate;
            snapshots.push({
              path: candidatePath,
              source: candidateBytes,
              kind: candidate.trustKind,
            });
            for (const input of typeof candidate.inputs === "function"
              ? candidate.inputs(decoded)
              : (candidate.inputs ?? [])) {
              const inputPath =
                input.root === "home"
                  ? await homePath(this.options.home, input.path)
                  : await projectPath(context.directory, input.path);
              const inputBytes =
                inputPath === candidatePath
                  ? candidateBytes
                  : await bytes(inputPath);
              if (inputBytes === undefined) {
                snapshots.push({
                  path: inputPath,
                  source: Buffer.alloc(0),
                  missing: true,
                });
                continue;
              }
              if (suppressed[inputPath] === digest(inputBytes)) {
                snapshots.push({ path: inputPath, source: inputBytes });
                continue;
              }
              let value: unknown;
              try {
                value = decodeConfiguration(inputBytes, input.decode);
                value = legacyVersion(value, input, type.version);
              } catch (error) {
                throw new ProjectInputError(inputPath, inputBytes, error);
              }
              if (input.select && !input.select(value)) {
                snapshots.push({ path: inputPath, source: inputBytes });
                continue;
              }
              inputs[input.path] = value;
              if (inputPath !== candidatePath)
                snapshots.push({
                  path: inputPath,
                  source: inputBytes,
                  kind: input.trustKind,
                });
            }
            break;
          }
        }
        if (!source) {
          this.record(context, type, path, "healthy");
          return { value: type.fallback(), path, classification: "healthy" };
        }
        let value: unknown = decodeConfiguration(
          source,
          legacy?.decode ?? type.decode,
        );
        if (legacy) {
          const accessor = legacy.version ?? type.version;
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Expected a legacy configuration object");
          const rawLegacy = value as Record<string, unknown>;
          const legacyVersion = Object.hasOwn(rawLegacy, accessor.field)
            ? rawLegacy[accessor.field]
            : accessor.absent;
          if (
            typeof legacyVersion !== "number" ||
            !Number.isSafeInteger(legacyVersion) ||
            legacyVersion < 1
          )
            throw new Error("Unrecognisable legacy configuration version");
          if (legacyVersion > legacy.currentVersion) {
            this.record(
              context,
              type,
              sourcePath,
              "incompatible",
              "This legacy configuration requires a newer Nerve version. The file is read-only.",
            );
            return {
              value: type.fallback(),
              path: sourcePath,
              classification: "incompatible",
            };
          }
          value = legacy.migrate(
            { ...rawLegacy, [accessor.field]: legacyVersion },
            inputs,
          );
        }
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Expected a configuration object");
        const raw = value as Record<string, unknown>;
        const version = Object.hasOwn(raw, type.version.field)
          ? raw[type.version.field]
          : type.version.absent;
        if (
          typeof version !== "number" ||
          !Number.isSafeInteger(version) ||
          version < 1
        )
          throw new Error("Unrecognisable configuration version");
        if (version > type.currentVersion) {
          this.record(
            context,
            type,
            sourcePath,
            "incompatible",
            "This configuration requires a newer Nerve version. Upgrade to use it; the file is read-only.",
          );
          return {
            value: type.fallback(),
            path: sourcePath,
            classification: "incompatible",
          };
        }
        value = { ...raw, [type.version.field]: version };
        for (let next = version; next < type.currentVersion; next++) {
          const migrate = type.migrators[next];
          if (!migrate)
            throw new Error(
              `Missing ${type.id} migration ${next} -> ${next + 1}`,
            );
          value = migrate(value);
          if (
            (value as Record<string, unknown>)?.[type.version.field] !==
            next + 1
          )
            throw new Error("Migrator did not advance exactly one version");
        }
        const validated = type.schema.parse(value);
        if (legacy || version < type.currentVersion) {
          for (const dependency of type.migrationDependencies ?? []) {
            if (dependency.id === type.id || ancestors.includes(dependency.id))
              throw new Error("Cyclic project migration dependency");
            this.register(dependency);
            const prerequisite = await this.load(context, dependency, [
              ...ancestors,
              type.id,
            ]);
            if (
              prerequisite.classification === "corrupted" ||
              prerequisite.classification === "incompatible"
            )
              throw new Error(
                `Migration requires healthy ${dependency.label}; originals were retained`,
              );
          }
          const release = await this.lock(path);
          let migrationMessage: string | undefined;
          try {
            const carry = await this.options.trust?.capture({
              type: type.id,
              projectId: context.projectId,
              path: sourcePath,
              source,
              targetKind: type.trustKind,
              sources: legacy ? snapshots : undefined,
            });
            for (const snapshot of snapshots)
              if (!snapshot.missing)
                await quarantine(
                  this.options.home,
                  context,
                  snapshot.path,
                  snapshot.source,
                );
            await quarantine(this.options.home, context, sourcePath, source);
            if (
              !(await bytes(sourcePath))?.equals(source) ||
              (legacy && (await bytes(path))) ||
              !(await this.unchanged(snapshots))
            )
              continue;
            await this.write(type, path, validated);
            // Use the deterministic bytes we wrote, never an external replacement.
            const written = Buffer.from(
              type.encode
                ? type.encode(validated)
                : `${JSON.stringify(validated, null, 2)}\n`,
            );
            if (!(await bytes(path))?.equals(written)) continue;
            try {
              await carry?.(path, written);
            } catch (error) {
              migrationMessage = `Configuration was upgraded, but trust could not be carried over; review it before approving: ${message(error)}`;
            }
          } finally {
            await release();
          }
          this.record(context, type, path, "migrated", migrationMessage);
          return {
            value: validated,
            path,
            classification: "migrated",
            sourceDigest: digest(
              type.encode
                ? type.encode(validated)
                : `${JSON.stringify(validated, null, 2)}\n`,
            ),
          };
        }
        this.record(context, type, path, "healthy");
        return {
          value: validated,
          path,
          classification: "healthy",
          sourceDigest: digest(source),
        };
      } catch (caught) {
        let error = caught;
        if (error instanceof ProjectInputError) {
          sourcePath = error.path;
          source = error.source;
          error = error.cause;
        }
        if (error instanceof NewerLegacyVersion) {
          this.record(context, type, sourcePath, "incompatible", error.message);
          return {
            value: type.fallback(),
            path: sourcePath,
            classification: "incompatible",
          };
        }
        this.record(context, type, sourcePath, "corrupted", message(error));
        return {
          value: type.fallback(),
          path: sourcePath,
          classification: "corrupted",
          sourceDigest: source && digest(source),
        };
      }
    }
    this.record(
      context,
      type,
      path,
      "corrupted",
      "Configuration kept changing; reload before retrying.",
    );
    return { value: type.fallback(), path, classification: "corrupted" };
  }
  /** The only feature-write entrypoint: fallback values are never writable. */
  async transact<T, R>(
    context: ProjectConfigurationContext,
    type: ProjectConfigurationType<T>,
    mutate: (
      value: T,
    ) =>
      | { result: R; changed: boolean; value?: T; remove?: boolean }
      | Promise<{ result: R; changed: boolean; value?: T; remove?: boolean }>,
  ): Promise<R> {
    const first = await this.load(context, type);
    this.assertWritable(type, first.classification);
    const path = await projectPath(context.directory, type.path);
    const release = await this.lock(path);
    try {
      const before = await bytes(path);
      const current = await this.load(context, type);
      this.assertWritable(type, current.classification);
      // A version change after acquiring the lock must be reloaded outside it.
      if (current.classification !== "healthy")
        throw new ApplicationError(
          409,
          "PROJECT_CONFIGURATION_CONFLICT",
          "Configuration changed; reload before editing.",
        );
      const mutation = await mutate(current.value);
      if (mutation.changed) {
        const after = await bytes(path);
        if (before ? !after?.equals(before) : after !== undefined)
          throw new ApplicationError(
            409,
            "PROJECT_CONFIGURATION_CONFLICT",
            "Configuration changed during editing; reload before retrying.",
          );
        if (mutation.remove) {
          if (before)
            await quarantine(this.options.home, context, path, before);
          await this.suppressLegacy(context, type);
          await this.options.trust?.revoke?.({
            type: type.id,
            projectId: context.projectId,
            paths: [path],
          });
          if (before) await unlink(path);
        } else
          await this.write(
            type,
            path,
            type.schema.parse(mutation.value ?? current.value),
          );
      }
      return mutation.result;
    } finally {
      await release();
    }
  }
  private assertWritable<T>(
    type: ProjectConfigurationType<T>,
    classification: ProjectConfigurationResult<T>["classification"],
  ): void {
    if (classification === "corrupted" || classification === "incompatible")
      throw new ApplicationError(
        409,
        "PROJECT_CONFIGURATION_UNAVAILABLE",
        `${type.label} are invalid or incompatible. Reload after fixing the file${classification === "corrupted" ? " or use confirmed reset" : " or upgrade Nerve"}; saving cannot overwrite the original.`,
      );
  }
  async reload<T>(
    context: ProjectConfigurationContext,
    type: ProjectConfigurationType<T>,
  ): Promise<ProjectConfigurationResult<T>> {
    for (const [key, issue] of this.issues)
      if (issue.projectId === context.projectId && issue.type === type.id)
        this.issues.delete(key);
    const result = await this.load(context, type);
    this.publishHealth(this.health(context.projectId));
    return result;
  }
  async reset<T>(
    context: ProjectConfigurationContext,
    type: ProjectConfigurationType<T>,
    confirmed: boolean,
    repair?: { value: T; sourceDigest: string },
  ): Promise<ProjectConfigurationResult<T>> {
    if (confirmed !== true) throw new Error("Reset requires confirmation");
    const loaded = await this.load(context, type);
    if (
      loaded.classification === "incompatible" ||
      (!repair && loaded.classification !== "corrupted")
    )
      throw new Error(
        "Only corrupted configuration can be reset; incompatible files are read-only",
      );
    const path = await projectPath(context.directory, type.path);
    const source = await bytes(loaded.path);
    if (!source) {
      if (repair && repair.sourceDigest === "missing") {
        await this.transact(context, type, () => ({
          value: repair.value,
          changed: true,
          result: undefined,
        }));
      } else if (repair)
        throw new Error("Configuration changed; reload before repairing");
      return this.reload(context, type);
    }
    if (repair && digest(source) !== repair.sourceDigest)
      throw new Error("Configuration changed; reload before repairing");
    if (digest(source) !== loaded.sourceDigest)
      throw new Error("Configuration changed; reload before resetting");
    const release = await this.lock(path);
    try {
      await quarantine(this.options.home, context, loaded.path, source);
      if (
        !(await bytes(loaded.path))?.equals(source) ||
        (loaded.path !== path && (await bytes(path)))
      )
        throw new Error("Configuration changed; reload before resetting");
      let shared = false;
      for (const legacy of type.legacySources ?? [])
        if (
          legacy.shared &&
          (await this.legacyPath(context, legacy)) === loaded.path
        )
          shared = true;
      await this.options.trust?.revoke?.({
        type: type.id,
        projectId: context.projectId,
        paths: shared ? [path] : [...new Set([path, loaded.path])],
      });
      const replacement = repair
        ? type.schema.parse(repair.value)
        : type.reset();
      if (
        !(await bytes(loaded.path))?.equals(source) ||
        (loaded.path !== path && (await bytes(path)))
      )
        throw new Error("Configuration changed; reload before resetting");
      await this.suppressLegacy(context, type);
      if (replacement === null) {
        // Shared legacy catalogs are retained: suppression is per target/entry.
        if (loaded.path === path || !type.legacySources?.length)
          await unlink(loaded.path);
      } else await this.write(type, path, type.schema.parse(replacement));
      // Deliberately no trust carry-over on reset.
    } finally {
      await release();
    }
    return this.reload(context, type);
  }
  private async suppressLegacy<T>(
    context: ProjectConfigurationContext,
    type: ProjectConfigurationType<T>,
  ): Promise<void> {
    const suppressed = await this.suppressed(context, type);
    for (const legacy of type.legacySources ?? []) {
      const sourcePath = await this.legacyPath(context, legacy);
      const original = await bytes(sourcePath);
      if (original) suppressed[sourcePath] = digest(original);
      for (const input of typeof legacy.inputs === "function"
        ? []
        : (legacy.inputs ?? [])) {
        const inputPath =
          input.root === "home"
            ? await homePath(this.options.home, input.path)
            : await projectPath(context.directory, input.path);
        const originalInput = await bytes(inputPath);
        if (originalInput) suppressed[inputPath] = digest(originalInput);
      }
    }
    await atomicWriteJson(
      this.suppressionPath(context, type),
      suppressed,
      0o600,
    );
  }
  private async write<T>(
    type: ProjectConfigurationType<T>,
    path: string,
    value: T,
  ): Promise<void> {
    if (type.encode)
      await atomicWriteFile(path, type.encode(value), { mode: 0o600 });
    else await (this.options.write ?? atomicWriteJson)(path, value, 0o600);
  }
  private async unchanged(
    snapshots: readonly { path: string; source: Buffer; missing?: boolean }[],
  ): Promise<boolean> {
    for (const snapshot of snapshots) {
      const current = await bytes(snapshot.path);
      if (
        snapshot.missing
          ? current !== undefined
          : !current?.equals(snapshot.source)
      )
        return false;
    }
    return true;
  }
  private async legacyPath(
    context: ProjectConfigurationContext,
    source: ProjectLegacySource,
  ): Promise<string> {
    const local =
      typeof source.path === "function" ? source.path(context) : source.path;
    return source.root === "home"
      ? homePath(this.options.home, local)
      : projectPath(context.directory, local);
  }
  private suppressionPath<T>(
    context: ProjectConfigurationContext,
    type: ProjectConfigurationType<T>,
  ): string {
    return join(
      this.options.home,
      "quarantine",
      "project-configuration",
      digest(context.projectId),
      digest(type.id + ":" + type.path) + ".reset.json",
    );
  }
  private async suppressed<T>(
    context: ProjectConfigurationContext,
    type: ProjectConfigurationType<T>,
  ): Promise<Record<string, string>> {
    const saved = await bytes(this.suppressionPath(context, type));
    if (!saved) return {};
    const value: unknown = decodeConfiguration(saved);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.values(value).some(
        (v) => typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v),
      )
    )
      throw new Error("Invalid project reset receipt");
    return value as Record<string, string>;
  }
  private async lock(path: string): Promise<() => Promise<void>> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const lockPath = `${path}.lock`;
    const file = await open(lockPath, "wx", 0o600).catch(
      (cause: NodeJS.ErrnoException) => {
        if (cause.code !== "EEXIST") throw cause;
        throw new ApplicationError(
          409,
          "PROJECT_CONFIGURATION_BUSY",
          `Cannot exclusively lock project configuration ${path}: another writer may be active. Refresh and retry. A leftover crash lock requires quiescing all writers before manually removing ${lockPath}; locks are never automatically stolen.`,
          { retryable: true },
        );
      },
    );
    const identity = await file.stat();
    return async () => {
      try {
        const current = await lstat(lockPath).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        if (current?.dev === identity.dev && current.ino === identity.ino)
          await unlink(lockPath);
      } finally {
        await file.close();
      }
    };
  }
}
