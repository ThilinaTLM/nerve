import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathExists } from "../../storage-bootstrap/json.js";
import type { StoragePaths } from "../../storage-bootstrap/paths.js";
import { assertStorageSpace, type StorageSpaceRequirement } from "./space.js";

export interface StorageMigrationWorkspace {
  id: string;
  root: string;
  sqlitePath: string;
  configPath: string;
  filesPath: string;
  requirement: StorageSpaceRequirement;
  discard(): Promise<void>;
}

export async function createStorageMigrationWorkspace(
  paths: StoragePaths,
  options: { id?: string } = {},
): Promise<StorageMigrationWorkspace> {
  const requirement = await assertStorageSpace(paths.home, [
    paths.sqlitePath,
    paths.daemonConfigPath,
    paths.harnessConfigPath,
    paths.uiConfigPath,
    paths.permissionsConfigPath,
    paths.providersConfigPath,
    paths.integrationsConfigPath,
  ]);
  const id = options.id ?? `${Date.now()}-${randomUUID()}`;
  const root = join(paths.migrationWorkPath, id);
  const sqlitePath = join(root, "nerve.sqlite");
  const configPath = join(root, "config");
  const filesPath = join(root, "files");
  await mkdir(paths.migrationWorkPath, { recursive: true, mode: 0o700 });
  await mkdir(root, { recursive: false, mode: 0o700 });
  try {
    await vacuumInto(paths.sqlitePath, sqlitePath);
    await cp(paths.configPath, configPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    await mkdir(filesPath, { mode: 0o700 });
    return {
      id,
      root,
      sqlitePath,
      configPath,
      filesPath,
      requirement,
      discard: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function createFreshStorageWorkspace(
  paths: StoragePaths,
  options: { id?: string } = {},
): Promise<StorageMigrationWorkspace> {
  const requirement = await assertStorageSpace(paths.home, [
    paths.daemonConfigPath,
    paths.harnessConfigPath,
    paths.uiConfigPath,
    paths.permissionsConfigPath,
    paths.providersConfigPath,
    paths.integrationsConfigPath,
  ]);
  const id = options.id ?? `${Date.now()}-${randomUUID()}`;
  const root = join(paths.migrationWorkPath, id);
  const sqlitePath = join(root, "nerve.sqlite");
  const configPath = join(root, "config");
  const filesPath = join(root, "files");
  await mkdir(paths.migrationWorkPath, { recursive: true, mode: 0o700 });
  await mkdir(root, { recursive: false, mode: 0o700 });
  try {
    new DatabaseSync(sqlitePath).close();
    await cp(paths.configPath, configPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    await mkdir(filesPath, { mode: 0o700 });
    return {
      id,
      root,
      sqlitePath,
      configPath,
      filesPath,
      requirement,
      discard: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function installFreshStorageWorkspace(
  paths: StoragePaths,
  workspace: StorageMigrationWorkspace,
): Promise<void> {
  if (await pathExists(paths.sqlitePath)) {
    throw new Error("Fresh storage installation found an existing database.");
  }
  const stagedFiles = await listWorkspaceFiles(workspace.filesPath);
  for (const source of stagedFiles) {
    const destination = join(paths.home, relative(workspace.filesPath, source));
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, await readFile(source), {
      flag: "wx",
      mode: 0o600,
    });
  }
  await rename(workspace.sqlitePath, paths.sqlitePath);
  await rm(workspace.root, { recursive: true, force: true });
}

export async function discardAbandonedWorkspaces(
  paths: StoragePaths,
  activeId?: string,
): Promise<void> {
  const entries = await readdir(paths.migrationWorkPath, {
    withFileTypes: true,
  }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== activeId)
      .map((entry) =>
        rm(join(paths.migrationWorkPath, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
  );
}

async function listWorkspaceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Migration workspace contains a non-file: ${path}`);
    }
  };
  await visit(root);
  return files.sort();
}

async function vacuumInto(sourcePath: string, destinationPath: string) {
  const database = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    database.exec(`VACUUM INTO ${sqlString(destinationPath)}`);
  } finally {
    database.close();
  }
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
