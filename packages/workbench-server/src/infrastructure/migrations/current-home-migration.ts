import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  CurrentHomeMigrationApproval,
  CurrentHomeMigrationPlan,
  CurrentHomeMigrationReport,
} from "@nervekit/contracts/storage";
import { CanonicalDatabase } from "../persistence/canonical-sqlite/canonical-database.js";
import {
  deleteConversationChunk,
  type ConversationDeletionCursor,
} from "../persistence/canonical-sqlite/conversation-deletion.js";
import { initializeStorage } from "../storage-bootstrap/initialize.js";
import { managedOwnerPathSegment } from "../storage-bootstrap/managed-owner-path.js";
import {
  pathExists,
  readJsonFile,
  atomicWriteJson,
} from "../storage-bootstrap/json.js";
import { storagePaths } from "../storage-bootstrap/paths.js";
import { assertCurrentStorage } from "../storage-bootstrap/storage-postconditions.js";
import { acquireStorageStartupLock } from "../storage-bootstrap/startup-lock.js";
import { inspectPendingHomeMigrations } from "./home-migration-plan.js";

type PromotionPhase = "staged" | "source-renamed" | "promoted";
type PromotionJournal = {
  home: string;
  staging: string;
  backupSibling: string;
  finalBackup: string;
  phase: PromotionPhase;
};

export async function applyHomeMigrationPlan(
  home: string,
  plan: CurrentHomeMigrationPlan,
  approval?: CurrentHomeMigrationApproval,
): Promise<CurrentHomeMigrationReport> {
  const resolvedHome = resolve(home);
  const lock = await acquireStorageStartupLock(resolvedHome, 15_000);
  const journalPath = `${resolvedHome}.current-migration.json`;
  try {
    await recoverPromotion(journalPath);
    const current = await inspectPendingHomeMigrations(resolvedHome);
    if (current.fingerprint !== plan.fingerprint) {
      throw new Error(
        "Storage migration plan changed; inspect and confirm it again.",
      );
    }
    const fatal = current.issues.find(
      (candidate) => candidate.disposition === "required",
    );
    if (fatal) throw new Error(fatal.reason);
    const skippable = current.issues.filter(
      (candidate) => candidate.disposition === "skippable",
    );
    const approved = new Set(
      approval?.fingerprint === current.fingerprint
        ? approval.approvedIssueIds
        : [],
    );
    const approvedExactly =
      approved.size === skippable.length &&
      skippable.every((candidate) => approved.has(candidate.id));
    if (!approvedExactly) {
      throw new Error("Conversation skips require exact explicit approval.");
    }
    if (current.migrationIds.length === 0) {
      return {
        format: "nerve-current-home-migration",
        version: 1,
        migrationIds: [],
        skippedConversations: [],
      };
    }

    const stamp = new Date().toISOString().replace(/[-:.]/g, "");
    const parent = dirname(resolvedHome);
    const base = resolvedHome.split(/[\\/]/).at(-1) ?? "nerve-home";
    const staging = join(parent, `.${base}.migration-${stamp}`);
    const backupSibling = join(parent, `.${base}.pre-migration-${stamp}`);
    const finalBackup = join(resolvedHome, "backups", `current-home-${stamp}`);
    for (const path of [staging, backupSibling]) {
      if (await pathExists(path))
        throw new Error(`Migration work path already exists: ${path}`);
    }

    await writePromotionJournal(journalPath, {
      home: resolvedHome,
      staging,
      backupSibling,
      finalBackup,
      phase: "staged",
    });
    await cp(resolvedHome, staging, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => !isBackupsPath(resolvedHome, source),
    });

    const skippedConversationIds = [
      ...new Set(
        skippable.flatMap((issue) =>
          issue.conversationId ? [issue.conversationId] : [],
        ),
      ),
    ];
    const stagingPaths = storagePaths(staging);
    const canonical = new CanonicalDatabase(stagingPaths.sqlitePath);
    try {
      canonical.initialize();
      for (const conversationId of skippedConversationIds) {
        deleteConversation(canonical, conversationId);
      }
    } finally {
      canonical.close();
    }
    for (const conversationId of skippedConversationIds) {
      await Promise.all([
        rm(
          join(
            stagingPaths.conversationsPath,
            managedOwnerPathSegment(conversationId, "conv_"),
          ),
          { recursive: true, force: true },
        ),
        rm(
          join(
            stagingPaths.dataPath,
            "payloads",
            "conversations",
            conversationId,
          ),
          { recursive: true, force: true },
        ),
      ]);
    }
    await removeQueryCache(stagingPaths.queryCachePath);

    const storage = await initializeStorage(staging);
    await storage.canonicalStore.close();
    await assertCurrentStorage(stagingPaths);
    await recordSkippedConversations(stagingPaths.migrationLedgerPath, current);

    await rename(resolvedHome, backupSibling);
    await writePromotionJournal(journalPath, {
      home: resolvedHome,
      staging,
      backupSibling,
      finalBackup,
      phase: "source-renamed",
    });
    try {
      await rename(staging, resolvedHome);
    } catch (error) {
      await rename(backupSibling, resolvedHome).catch(() => undefined);
      throw error;
    }
    await writePromotionJournal(journalPath, {
      home: resolvedHome,
      staging,
      backupSibling,
      finalBackup,
      phase: "promoted",
    });
    await mkdir(dirname(finalBackup), { recursive: true, mode: 0o700 });
    await rename(backupSibling, finalBackup);
    await rm(journalPath, { force: true });

    return {
      format: "nerve-current-home-migration",
      version: 1,
      migrationIds: current.migrationIds,
      skippedConversations: skippedConversationIds.map((conversationId) => {
        const issue = skippable.find(
          (candidate) => candidate.conversationId === conversationId,
        )!;
        return {
          conversationId,
          issueId: issue.id,
          code: issue.code,
          reason: issue.reason,
        };
      }),
      backupPath: finalBackup,
    };
  } finally {
    await lock.release();
  }
}

function deleteConversation(
  canonical: CanonicalDatabase,
  conversationId: string,
): void {
  let cursor: ConversationDeletionCursor = { phase: "events" };
  while (true) {
    const chunk = canonical.transaction((database) =>
      deleteConversationChunk(database, conversationId, 500, cursor),
    );
    if (chunk.done) break;
    cursor = chunk.next;
  }
  canonical.transaction((database) => {
    database
      .prepare(
        `DELETE FROM domain_documents
         WHERE namespace = 'agent'
           AND json_extract(CAST(data AS TEXT), '$.conversationId') = ?`,
      )
      .run(conversationId);
  });
}

async function recordSkippedConversations(
  ledgerPath: string,
  plan: CurrentHomeMigrationPlan,
): Promise<void> {
  const skipped = plan.issues
    .filter((issue) => issue.disposition === "skippable")
    .map((issue) => ({
      issueId: issue.id,
      conversationId: issue.conversationId,
      code: issue.code,
      reason: issue.reason,
    }));
  if (skipped.length === 0) return;
  const ledger = await readJsonFile<{
    format: string;
    version: number;
    entries: Array<Record<string, unknown>>;
  }>(ledgerPath);
  ledger.entries.push({
    id: `approved-conversation-skips:${plan.fingerprint}`,
    appliedAt: new Date().toISOString(),
    skipped,
  });
  await atomicWriteJson(ledgerPath, ledger, 0o600);
}

async function removeQueryCache(path: string): Promise<void> {
  await Promise.all(
    [path, `${path}-wal`, `${path}-shm`].map((candidate) =>
      rm(candidate, { force: true }),
    ),
  );
}

function isBackupsPath(home: string, candidate: string): boolean {
  const backups = join(home, "backups");
  return (
    candidate === backups ||
    candidate.startsWith(`${backups}/`) ||
    candidate.startsWith(`${backups}\\`)
  );
}

async function writePromotionJournal(
  path: string,
  journal: PromotionJournal,
): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function recoverPromotion(journalPath: string): Promise<void> {
  if (!(await pathExists(journalPath))) return;
  const journal = JSON.parse(
    await readFile(journalPath, "utf8"),
  ) as PromotionJournal;
  const homeExists = await pathExists(journal.home);
  const backupExists = await pathExists(journal.backupSibling);
  if (!homeExists && backupExists) {
    await rename(journal.backupSibling, journal.home);
    await rm(journal.staging, { recursive: true, force: true });
    await rm(journalPath, { force: true });
    return;
  }
  if ((journal.phase === "promoted" || homeExists) && backupExists) {
    await mkdir(dirname(journal.finalBackup), { recursive: true, mode: 0o700 });
    await rename(journal.backupSibling, journal.finalBackup);
  }
  if (journal.phase === "staged") {
    await rm(journal.staging, { recursive: true, force: true });
  }
  await rm(journalPath, { force: true });
}
