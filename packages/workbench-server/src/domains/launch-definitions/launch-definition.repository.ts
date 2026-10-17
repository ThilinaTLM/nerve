import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Project } from "@nervekit/contracts/core";
import {
  launchDefinitionFileSchema,
  launchDefinitionV1FileSchema,
  type LaunchDefinitionFile,
  type LaunchDefinitionCatalog,
} from "@nervekit/contracts/launch-definitions";
import { atomicWriteJson } from "../../infrastructure/storage-bootstrap/index.js";
import { ApplicationError } from "../../core/application-error.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function launchCatalogRevision(file: LaunchDefinitionFile): string {
  const sort = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          ...file,
          folders: sort(file.folders),
          definitions: sort(file.definitions),
        }),
      ),
    )
    .digest("hex");
}
export class LaunchDefinitionRepository {
  constructor(
    private readonly getProject: (id: string) => Project,
    private readonly write: typeof atomicWriteJson = atomicWriteJson,
  ) {}
  async catalog(projectId: string): Promise<LaunchDefinitionCatalog> {
    const { file } = await this.read(await this.path(projectId));
    return this.runtime(projectId, file);
  }
  async list(projectId: string) {
    return (await this.catalog(projectId)).definitions;
  }
  async transact<T>(
    projectId: string,
    expectedRevision: string,
    mutate: (file: LaunchDefinitionFile) => T,
  ): Promise<{ result: T; revision: string; changed: boolean }> {
    const path = await this.path(projectId);
    const directory = join(path, "..");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // An exclusive, persistent lock fails closed. Never infer dead ownership from
    // age/PID: crash leftovers require operator removal after quiescing writers.
    const lockPath = `${path}.lock`;
    const lock = await open(lockPath, "wx", 0o600).catch((cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
        const error = new ApplicationError(
          409,
          "LAUNCH_CATALOG_BUSY",
          `Cannot exclusively lock launch catalog ${path}: another writer may be active. Refresh and retry after it finishes. A leftover crash lock requires quiescing all writers before manually removing ${lockPath}; locks are never automatically stolen.`,
          { retryable: true },
        );
        error.cause = cause;
        throw error;
      }
      throw new Error(
        `Cannot establish exclusive coordination for launch catalog ${path}.`,
        { cause },
      );
    });
    const lockIdentity = await lock.stat();
    try {
      const { file, source, legacy } = await this.read(path);
      const previousRevision = launchCatalogRevision(file);
      if (expectedRevision !== previousRevision)
        throw new ApplicationError(
          409,
          "LAUNCH_CATALOG_CONFLICT",
          "Launch catalog changed; refresh before retrying.",
        );
      const result = mutate(file);
      const validated = launchDefinitionFileSchema.parse(file);
      const revision = launchCatalogRevision(validated);
      const changed = revision !== previousRevision;
      if (changed) {
        if (legacy && source) await this.backup(path, source);
        await this.write(path, validated, 0o600);
      }
      return { result, revision, changed };
    } finally {
      try {
        const current = await lstat(lockPath);
        if (
          current.dev === lockIdentity.dev &&
          current.ino === lockIdentity.ino
        )
          await unlink(lockPath);
        else
          console.error(
            "Launch catalog lock was replaced; leaving replacement intact",
            { lockPath },
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          console.error(
            "Launch catalog lock cleanup failed; future writes fail closed",
            { lockPath, error },
          );
      }
      try {
        await lock.close();
      } catch (error) {
        console.error("Launch catalog lock close failed", { lockPath, error });
      }
    }
  }
  private runtime(
    projectId: string,
    file: LaunchDefinitionFile,
  ): LaunchDefinitionCatalog {
    return {
      projectId,
      revision: launchCatalogRevision(file),
      folders: file.folders,
      definitions: file.definitions.map((d) => ({
        ...d,
        scope: { kind: "project", projectId },
      })),
    };
  }
  private async backup(path: string, source: Buffer): Promise<void> {
    const backupPath = join(dirname(path), "definitions.v1.backup.json");
    let handle;
    try {
      handle = await open(backupPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await readFile(backupPath)).equals(source))
        throw new Error(
          `Launch catalog backup differs from source: ${backupPath}`,
          { cause: error },
        );
      return;
    }
    try {
      await handle.writeFile(source);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  private async read(
    path: string,
  ): Promise<{ file: LaunchDefinitionFile; source?: Buffer; legacy: boolean }> {
    let source: Buffer;
    try {
      source = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        try {
          await readFile(join(dirname(path), "definitions.v1.backup.json"));
        } catch (backupError) {
          if ((backupError as NodeJS.ErrnoException).code === "ENOENT")
            return {
              file: { version: 2, folders: [], definitions: [] },
              legacy: false,
            };
          throw backupError;
        }
        throw new Error(
          `Missing authoritative launch catalog with conversion backup present: ${path}`,
          { cause: error },
        );
      }
      throw error;
    }
    try {
      const raw = JSON.parse(source.toString("utf8"));
      if (raw.version === 1) {
        const old = launchDefinitionV1FileSchema.parse(raw);
        return {
          source,
          legacy: true,
          file: launchDefinitionFileSchema.parse({
            version: 2,
            folders: [],
            definitions: old.definitions.map((d, order) => ({
              ...d,
              parentFolderId: null,
              order,
            })),
          }),
        };
      }
      return {
        source,
        legacy: false,
        file: launchDefinitionFileSchema.parse(raw),
      };
    } catch (cause) {
      throw new Error(
        `Invalid project launch definitions at ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }
  private async path(projectId: string): Promise<string> {
    const project = this.getProject(projectId);
    // Resolve the directory before creating infrastructure: project aliases share
    // the same path and filesystem lock, including across Nerve processes.
    const resolveExisting = async (path: string): Promise<string> => {
      try {
        return await realpath(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return join(await resolveExisting(dirname(path)), basename(path));
      }
    };
    const directory = await realpath(project.directory);
    return resolveExisting(
      join(directory, ".nerve", "launches", "definitions.json"),
    );
  }
}
