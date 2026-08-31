import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../storage-bootstrap/json.js";
import type { StoragePaths } from "../storage-bootstrap/paths.js";

export const CONSOLIDATE_MANAGED_FILES_MIGRATION =
  "consolidate-conversation-and-task-files-v1";

type MigrationLedger = {
  format: string;
  version: number;
  entries: Array<{ id?: unknown; [key: string]: unknown }>;
};

export async function consolidateManagedFiles(
  paths: StoragePaths,
): Promise<void> {
  const ledger = await readMigrationLedger(paths.migrationLedgerPath);
  const recorded = ledger.entries.some(
    (entry) => entry.id === CONSOLIDATE_MANAGED_FILES_MIGRATION,
  );

  const legacyTasksPath = join(paths.home, "tasks");
  const legacyPayloadsPath = join(paths.dataPath, "payloads");
  const legacyConversationsPath = join(legacyPayloadsPath, "conversations");

  if (recorded) {
    await rejectPopulatedLegacyPath(legacyTasksPath, "legacy task root");
    await rejectPopulatedLegacyPath(
      legacyConversationsPath,
      "legacy conversation payload root",
    );
    await normalizeConversationTree(paths.conversationsPath);
    await removeIfEmpty(legacyPayloadsPath);
    return;
  }

  await relocateDirectory(legacyTasksPath, paths.tasksPath, "task bundles");
  await relocateDirectory(
    legacyConversationsPath,
    paths.conversationsPath,
    "conversation payloads",
  );
  await normalizeConversationTree(paths.conversationsPath);
  await removeIfEmpty(legacyPayloadsPath);
}

export async function recordConsolidatedManagedFiles(
  paths: StoragePaths,
): Promise<void> {
  const ledger = await readMigrationLedger(paths.migrationLedgerPath);
  if (
    ledger.entries.some(
      (entry) => entry.id === CONSOLIDATE_MANAGED_FILES_MIGRATION,
    )
  ) {
    return;
  }
  ledger.entries.push({
    id: CONSOLIDATE_MANAGED_FILES_MIGRATION,
    appliedAt: new Date().toISOString(),
  });
  await atomicWriteJson(paths.migrationLedgerPath, ledger, 0o600);
}

async function readMigrationLedger(path: string): Promise<MigrationLedger> {
  if (!(await pathExists(path))) {
    throw new Error("Nerve migration ledger is missing.");
  }
  const value = await readJsonFile<unknown>(path);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Nerve migration ledger is invalid.");
  }
  const ledger = value as Partial<MigrationLedger>;
  if (
    typeof ledger.format !== "string" ||
    typeof ledger.version !== "number" ||
    !Array.isArray(ledger.entries)
  ) {
    throw new Error("Nerve migration ledger is invalid.");
  }
  return ledger as MigrationLedger;
}

async function relocateDirectory(
  source: string,
  target: string,
  label: string,
): Promise<void> {
  const [sourceKind, targetKind] = await Promise.all([
    pathKind(source),
    pathKind(target),
  ]);
  if (sourceKind === "invalid" || targetKind === "invalid") {
    throw new Error(
      `Cannot migrate ${label}: a storage path is not a directory.`,
    );
  }
  if (sourceKind === "missing") {
    await mkdir(target, { recursive: true, mode: 0o700 });
    return;
  }
  if (targetKind === "missing") {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await rename(source, target);
    return;
  }
  const [sourceEmpty, targetEmpty] = await Promise.all([
    isEmptyDirectory(source),
    isEmptyDirectory(target),
  ]);
  if (sourceEmpty) {
    await rm(source, { recursive: true, force: true });
    return;
  }
  if (targetEmpty) {
    await rm(target, { recursive: true, force: true });
    await rename(source, target);
    return;
  }
  throw new Error(
    `Cannot migrate ${label}: both '${source}' and '${target}' contain data.`,
  );
}

async function normalizeConversationTree(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const conversations = await readdir(root, { withFileTypes: true });
  for (const entry of conversations) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(
        `Invalid conversation storage entry '${join(root, entry.name)}'.`,
      );
    }
    const conversationPath = await normalizeOwnerDirectory(
      root,
      entry.name,
      "conv_",
      "conversation",
    );
    const toolCallsPath = join(conversationPath, "tool-calls");
    if ((await pathKind(toolCallsPath)) === "missing") continue;
    if ((await pathKind(toolCallsPath)) !== "directory") {
      throw new Error(`Invalid tool-call storage path '${toolCallsPath}'.`);
    }
    const calls = await readdir(toolCallsPath, { withFileTypes: true });
    for (const call of calls) {
      if (!call.isDirectory() || call.isSymbolicLink()) {
        throw new Error(
          `Invalid tool-call storage entry '${join(toolCallsPath, call.name)}'.`,
        );
      }
      await normalizeOwnerDirectory(
        toolCallsPath,
        call.name,
        "tool_",
        "tool call",
      );
    }
  }
}

async function normalizeOwnerDirectory(
  root: string,
  name: string,
  prefix: "conv_" | "tool_",
  label: string,
): Promise<string> {
  const compact = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  if (!compact || !/^[A-Za-z0-9_-]+$/.test(compact)) {
    throw new Error(
      `Invalid ${label} storage directory '${join(root, name)}'.`,
    );
  }
  const source = join(root, name);
  const target = join(root, compact);
  if (source === target) return target;
  await relocateDirectory(source, target, `${label} directory`);
  return target;
}

async function rejectPopulatedLegacyPath(
  path: string,
  label: string,
): Promise<void> {
  const kind = await pathKind(path);
  if (kind === "missing") return;
  if (kind !== "directory") {
    throw new Error(`Invalid ${label} '${path}'.`);
  }
  if (!(await isEmptyDirectory(path))) {
    throw new Error(
      `Cannot start because ${label} '${path}' contains data after migration.`,
    );
  }
  await rm(path, { recursive: true, force: true });
}

async function removeIfEmpty(path: string): Promise<void> {
  if ((await pathKind(path)) !== "directory") return;
  if (await isEmptyDirectory(path)) {
    await rm(path, { recursive: true, force: true });
  }
}

async function isEmptyDirectory(path: string): Promise<boolean> {
  return (await readdir(path)).length === 0;
}

async function pathKind(
  path: string,
): Promise<"missing" | "directory" | "invalid"> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info) return "missing";
  return info.isDirectory() && !info.isSymbolicLink() ? "directory" : "invalid";
}
