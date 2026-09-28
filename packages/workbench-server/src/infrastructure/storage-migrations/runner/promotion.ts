import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { StoragePaths } from "../../storage-bootstrap/paths.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../storage-bootstrap/json.js";
import type { StorageMigrationWorkspace } from "./workspace.js";

type PromotionPhase =
  | "prepared"
  | "files-installed"
  | "database-backed-up"
  | "database-installed"
  | "config-backed-up"
  | "config-installed"
  | "committed";

interface StoragePromotionJournal {
  format: "nerve-storage-promotion";
  version: 1;
  phase: PromotionPhase;
  workspace: string;
  workspaceDatabase: string;
  workspaceConfig: string;
  liveDatabase: string;
  liveConfig: string;
  snapshot: string;
  snapshotDatabase: string;
  snapshotConfig: string;
  stagedFiles: string[];
}

export interface StoragePromotionResult {
  snapshotPath: string;
}

export async function promoteStorageMigrationWorkspace(
  paths: StoragePaths,
  workspace: StorageMigrationWorkspace,
  firstStepId: string,
  options: { now?: () => Date } = {},
): Promise<StoragePromotionResult> {
  await recoverStoragePromotion(paths);
  const now = options.now ?? (() => new Date());
  const stamp = now().toISOString().replace(/[-:.]/g, "");
  const safeStep = firstStepId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const snapshot = join(
    paths.storageBackupsPath,
    `${stamp}-before-${safeStep}`,
  );
  await mkdir(paths.storageBackupsPath, { recursive: true, mode: 0o700 });
  await mkdir(snapshot, { recursive: false, mode: 0o700 });
  const stagedFiles = await listFiles(workspace.filesPath);
  const journal: StoragePromotionJournal = {
    format: "nerve-storage-promotion",
    version: 1,
    phase: "prepared",
    workspace: workspace.root,
    workspaceDatabase: workspace.sqlitePath,
    workspaceConfig: workspace.configPath,
    liveDatabase: paths.sqlitePath,
    liveConfig: paths.configPath,
    snapshot,
    snapshotDatabase: join(snapshot, basename(paths.sqlitePath)),
    snapshotConfig: join(snapshot, "config"),
    stagedFiles,
  };
  await writeJournal(paths, journal);
  try {
    await installStagedFiles(paths.home, workspace.filesPath, stagedFiles);
    await updatePhase(paths, journal, "files-installed");
    await rename(journal.liveDatabase, journal.snapshotDatabase);
    await updatePhase(paths, journal, "database-backed-up");
    await rename(journal.workspaceDatabase, journal.liveDatabase);
    await updatePhase(paths, journal, "database-installed");
    await rename(journal.liveConfig, journal.snapshotConfig);
    await updatePhase(paths, journal, "config-backed-up");
    await rename(journal.workspaceConfig, journal.liveConfig);
    await updatePhase(paths, journal, "config-installed");
    await updatePhase(paths, journal, "committed");
    await rm(paths.migrationPromotionJournalPath, { force: true });
    await rm(workspace.root, { recursive: true, force: true });
    return { snapshotPath: snapshot };
  } catch (error) {
    await recoverStoragePromotion(paths).catch(() => undefined);
    throw error;
  }
}

export async function recoverStoragePromotion(
  paths: StoragePaths,
): Promise<void> {
  if (!(await pathExists(paths.migrationPromotionJournalPath))) return;
  const journal = await readJsonFile<StoragePromotionJournal>(
    paths.migrationPromotionJournalPath,
  );
  assertJournal(journal, paths);
  if (journal.phase === "committed") {
    await rm(journal.workspace, { recursive: true, force: true });
    await rm(paths.migrationPromotionJournalPath, { force: true });
    return;
  }

  // A pre-commit interruption always restores the original pair. Existence
  // checks make recovery safe when a crash happened after rename but before
  // the corresponding phase write.
  if (await pathExists(journal.snapshotConfig)) {
    if (await pathExists(journal.liveConfig)) {
      if (!(await pathExists(journal.workspaceConfig))) {
        await rename(journal.liveConfig, journal.workspaceConfig);
      } else {
        await rm(journal.liveConfig, { recursive: true, force: true });
      }
    }
    await rename(journal.snapshotConfig, journal.liveConfig);
  }
  if (await pathExists(journal.snapshotDatabase)) {
    if (await pathExists(journal.liveDatabase)) {
      if (!(await pathExists(journal.workspaceDatabase))) {
        await rename(journal.liveDatabase, journal.workspaceDatabase);
      } else {
        await rm(journal.liveDatabase, { force: true });
      }
    }
    await rename(journal.snapshotDatabase, journal.liveDatabase);
  }
  await removeInstalledStagedFiles(
    paths.home,
    join(journal.workspace, "files"),
    journal.stagedFiles,
  );
  await rm(journal.workspace, { recursive: true, force: true });
  await rm(journal.snapshot, { recursive: true, force: true });
  await rm(paths.migrationPromotionJournalPath, { force: true });
}

async function updatePhase(
  paths: StoragePaths,
  journal: StoragePromotionJournal,
  phase: PromotionPhase,
): Promise<void> {
  journal.phase = phase;
  await writeJournal(paths, journal);
}

async function writeJournal(
  paths: StoragePaths,
  journal: StoragePromotionJournal,
): Promise<void> {
  await atomicWriteJson(paths.migrationPromotionJournalPath, journal, 0o600);
}

function assertJournal(
  journal: StoragePromotionJournal,
  paths: StoragePaths,
): void {
  if (
    journal.format !== "nerve-storage-promotion" ||
    journal.version !== 1 ||
    journal.liveDatabase !== paths.sqlitePath ||
    journal.liveConfig !== paths.configPath ||
    !isWithin(paths.migrationWorkPath, journal.workspace) ||
    !isWithin(paths.storageBackupsPath, journal.snapshot) ||
    !Array.isArray(journal.stagedFiles)
  ) {
    throw new Error("Storage promotion journal is invalid for this home.");
  }
}

function isWithin(root: string, candidate: string): boolean {
  const offset = relative(resolve(root), resolve(candidate));
  return Boolean(offset) && offset !== ".." && !offset.startsWith(`..${sep}`);
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(relative(root, path));
      else
        throw new Error(`Migration staging contains a non-file entry: ${path}`);
    }
  };
  await visit(root);
  return result;
}

async function installStagedFiles(
  home: string,
  staging: string,
  files: readonly string[],
): Promise<void> {
  for (const relativePath of files) {
    const source = confined(staging, relativePath);
    const destination = confined(home, relativePath);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, await readFile(source), {
      flag: "wx",
      mode: 0o600,
    });
  }
}

async function removeInstalledStagedFiles(
  home: string,
  _staging: string,
  files: readonly string[],
): Promise<void> {
  for (const relativePath of files) {
    // The executor proves every staged destination was absent before the
    // journal was created. While the home lock is held no other owner may
    // create it, so rollback can remove even a partially written file.
    await rm(confined(home, relativePath), { force: true });
  }
}

function confined(root: string, path: string): string {
  const target = resolve(root, path);
  const offset = relative(resolve(root), target);
  if (!path || offset === ".." || offset.startsWith(`..${sep}`)) {
    throw new Error("Promotion path escapes its root.");
  }
  return target;
}
