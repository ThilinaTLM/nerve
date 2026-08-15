import {
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { atomicWriteJson, pathExists } from "../storage/json.js";
import { MigrationError } from "./migration.js";
import { invalidateDerivedDatabase } from "./sqlite.js";

interface BackupEntry {
  path: string;
  existed: boolean;
  bytes: number;
}
interface ActiveBatch {
  format: "nerve-migration-active-batch";
  version: 1;
  id: string;
  ledgerDigest: string;
  entries: BackupEntry[];
}

export interface RollbackBundle {
  id: string;
  bytes: number;
  directory: string;
  activePath: string;
}

export async function createRollbackBundle(input: {
  home: string;
  migrationsDir: string;
  id: string;
  ledgerDigest: string;
  paths: string[];
}): Promise<RollbackBundle> {
  const directory = join(input.migrationsDir, "rollback", input.id);
  const activePath = join(input.migrationsDir, "active-batch.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entries: BackupEntry[] = [];
  for (const path of [...new Set(input.paths)].sort()) {
    const source = safeCanonicalPath(input.home, path);
    const existed = await pathExists(source);
    const bytes = existed
      ? await copyCanonical(source, join(directory, "files", path))
      : 0;
    entries.push({ path, existed, bytes });
  }
  const manifest: ActiveBatch = {
    format: "nerve-migration-active-batch",
    version: 1,
    id: input.id,
    ledgerDigest: input.ledgerDigest,
    entries,
  };
  await atomicWriteJson(join(directory, "manifest.json"), manifest, 0o600);
  await atomicWriteJson(activePath, manifest, 0o600);
  return {
    id: input.id,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    directory,
    activePath,
  };
}

export async function recoverInterruptedBatch(
  home: string,
  migrationsDir: string,
  sqlitePath: string,
  currentLedgerDigest?: string,
): Promise<boolean> {
  const activePath = join(migrationsDir, "active-batch.json");
  if (!(await pathExists(activePath))) return false;
  let manifest: ActiveBatch;
  try {
    manifest = JSON.parse(await readFile(activePath, "utf8")) as ActiveBatch;
  } catch (error) {
    throw new MigrationError(
      "Interrupted migration manifest is unreadable.",
      undefined,
      {
        cause: error,
      },
    );
  }
  if (
    manifest.format !== "nerve-migration-active-batch" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.entries)
  ) {
    throw new MigrationError("Interrupted migration manifest is invalid.");
  }
  const directory = join(migrationsDir, "rollback", manifest.id);
  if (
    currentLedgerDigest !== undefined &&
    manifest.ledgerDigest !== currentLedgerDigest
  ) {
    // The atomic ledger commit landed and only post-commit cleanup was interrupted.
    await rm(activePath, { force: true });
    await rm(directory, { recursive: true, force: true });
    return false;
  }
  for (const entry of manifest.entries) {
    const target = safeCanonicalPath(home, entry.path);
    await rm(target, { recursive: true, force: true });
    if (entry.existed) {
      await copyCanonical(join(directory, "files", entry.path), target);
    }
  }
  invalidateDerivedDatabase(sqlitePath);
  await rm(activePath, { force: true });
  await rm(directory, { recursive: true, force: true });
  return true;
}

export async function discardRollbackBundle(
  bundle: RollbackBundle,
): Promise<void> {
  await rm(bundle.activePath, { force: true });
  await rm(bundle.directory, { recursive: true, force: true });
}

function safeCanonicalPath(home: string, path: string): string {
  if (!path || path.startsWith("/") || path.includes("\\")) {
    throw new MigrationError(`Unsafe migration backup path '${path}'.`);
  }
  const root = resolve(home);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel === "") {
    throw new MigrationError(`Unsafe migration backup path '${path}'.`);
  }
  return target;
}

async function copyCanonical(source: string, target: string): Promise<number> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    throw new MigrationError(`Refusing to migrate symbolic link '${source}'.`);
  }
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true, mode: info.mode & 0o777 });
    let bytes = 0;
    for (const entry of await readdir(source)) {
      bytes += await copyCanonical(join(source, entry), join(target, entry));
    }
    await chmod(target, info.mode & 0o777).catch(() => undefined);
    return bytes;
  }
  if (!info.isFile()) {
    throw new MigrationError(`Unsupported canonical path '${source}'.`);
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target, constants.COPYFILE_FICLONE);
  await chmod(target, info.mode & 0o777);
  return info.size;
}
