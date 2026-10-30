import {
  digest,
  bytes,
  projectPath,
  quarantine,
  decodeConfiguration,
} from "./project-migration-files.js";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  ProjectConfigurationHealth,
  ProjectConfigurationIssue,
  ResolveProjectConfiguration,
} from "@nervekit/contracts/projects";
import { ApplicationError } from "../../../core/application-error.js";
import { atomicWriteFile } from "../../storage-bootstrap/file-mutations.js";
import { findLegacyFiles } from "./project-legacy-files.js";
import { atomicWriteJson } from "../../storage-bootstrap/json.js";

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
  /** Notice only: these files are never read as migration inputs. */
  readonly legacyFiles?: readonly string[];
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
    if (request.type === "legacy-files") {
      if (request.action === "remove-legacy")
        await this.removeLegacy(context, request.confirmed);
      else if (request.action === "reload") await this.recordLegacy(context);
      else throw new Error("Legacy files cannot be reset");
      return this.health(context.projectId);
    }
    const type = this.types.get(request.type);
    if (!type)
      throw new Error(`Unknown project configuration type: ${request.type}`);
    if (request.action === "reset")
      await this.reset(context, type, request.confirmed);
    else if (request.action === "reload") await this.reload(context, type);
    else
      throw new Error("Remove old files is only available for legacy notices");
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
        issue.type === type.id &&
        issue.classification !== "legacy"
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
  ): Promise<ProjectConfigurationResult<T>> {
    let path = resolve(context.directory, ".nerve", type.path);
    try {
      await this.recordLegacy(context, type.legacyFiles);
      path = await projectPath(context.directory, type.path);
    } catch (error) {
      this.record(context, type, path, "corrupted", message(error), false);
      return { path, classification: "corrupted", value: type.fallback() };
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      let source: Buffer | undefined;
      try {
        source = await bytes(path);
        if (!source) {
          this.record(context, type, path, "healthy");
          return { value: type.fallback(), path, classification: "healthy" };
        }
        let value: unknown = decodeConfiguration(source, type.decode);
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
            path,
            "incompatible",
            "This configuration requires a newer Nerve version. Upgrade to use it; the file is read-only.",
          );
          return {
            value: type.fallback(),
            path: path,
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
        if (version < type.currentVersion) {
          const release = await this.lock(path);
          let migrationMessage: string | undefined;
          try {
            const carry = await this.options.trust?.capture({
              type: type.id,
              projectId: context.projectId,
              path: path,
              source,
            });
            await quarantine(this.options.home, context, path, source);
            if (!(await bytes(path))?.equals(source)) continue;
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
      } catch (error) {
        this.record(context, type, path, "corrupted", message(error));
        return {
          value: type.fallback(),
          path: path,
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
      if (!(await bytes(path))?.equals(source))
        throw new Error("Configuration changed; reload before resetting");
      await this.options.trust?.revoke?.({
        type: type.id,
        projectId: context.projectId,
        paths: [path],
      });
      const replacement = repair
        ? type.schema.parse(repair.value)
        : type.reset();
      if (!(await bytes(path))?.equals(source))
        throw new Error("Configuration changed; reload before resetting");
      if (replacement === null) await unlink(path);
      else await this.write(type, path, type.schema.parse(replacement));
      // Deliberately no trust carry-over on reset.
    } finally {
      await release();
    }
    return this.reload(context, type);
  }
  private readonly legacyPatterns = new Map<string, Set<string>>();
  private async recordLegacy(
    context: ProjectConfigurationContext,
    declared: readonly string[] = [],
  ): Promise<string[]> {
    const patterns =
      this.legacyPatterns.get(context.projectId) ?? new Set<string>();
    for (const name of [
      ...declared,
      ...[...this.types.values()].flatMap((type) => type.legacyFiles ?? []),
    ])
      patterns.add(name);
    this.legacyPatterns.set(context.projectId, patterns);
    const files = await findLegacyFiles(context.directory, [...patterns]);
    const key = JSON.stringify([context.projectId, "legacy-files"]);
    const previous = this.issues.get(key);
    if (files.length)
      this.issues.set(key, {
        projectId: context.projectId,
        type: "legacy-files",
        label: "Old project settings",
        path: resolve(context.directory, ".nerve"),
        classification: "legacy",
        files,
        message:
          "Project settings from an older Nerve weren't imported; configure them again.",
        resetDescription: "",
        resetOffered: false,
      });
    else this.issues.delete(key);
    if (JSON.stringify(previous) !== JSON.stringify(this.issues.get(key)))
      this.publishHealth(this.health(context.projectId));
    return files;
  }
  private async removeLegacy(
    context: ProjectConfigurationContext,
    confirmed: boolean,
  ): Promise<void> {
    if (confirmed !== true)
      throw new Error("Removing old files requires confirmation");
    const files = await this.recordLegacy(context);
    const releases: (() => Promise<void>)[] = [];
    try {
      const originals: { path: string; source: Buffer }[] = [];
      for (const file of files) {
        // Revalidate confinement and reject links before any destructive operation.
        const local = file.slice(
          resolve(context.directory, ".nerve").length + 1,
        );
        const path = await projectPath(context.directory, local);
        if (path !== resolve(file) || !(await lstat(file)).isFile())
          throw new Error("Remove legacy links manually before retrying");
        releases.push(await this.lock(path));
        const source = await bytes(path);
        if (source) originals.push({ path, source });
      }
      for (const { path, source } of originals)
        await quarantine(this.options.home, context, path, source);
      for (const { path, source } of originals)
        if (!(await bytes(path))?.equals(source))
          throw new Error("Old files changed; reload before removing");
      for (const { path } of originals) await unlink(path);
    } finally {
      for (const release of releases.reverse()) await release();
      await this.recordLegacy(context);
    }
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
