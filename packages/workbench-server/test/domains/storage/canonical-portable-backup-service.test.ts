import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { portableBackupManifestSchema } from "@nervekit/contracts/storage";
import { CanonicalConversationCreationService } from "../../../src/domains/conversations/timeline/canonical-conversation-creation.service.js";
import { CanonicalBackupInspectionService } from "../../../src/domains/storage/canonical-backup-inspection.service.js";
import { CanonicalBackupVerifier } from "../../../src/domains/storage/canonical-backup-verifier.js";
import { CanonicalRestoreStagingService } from "../../../src/domains/storage/canonical-restore-staging.service.js";
import { CanonicalPortableBackupService } from "../../../src/domains/storage/canonical-portable-backup.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalRunTimelineService } from "../../../src/domains/conversations/timeline/canonical-run-timeline.service.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";

test("INV-BACKUP-01 creates a verified canonical database and policy snapshot", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-backup-"));
  const paths = storagePaths(home);
  await Promise.all([
    mkdir(paths.dataPath, { recursive: true }),
    mkdir(paths.backupsPath, { recursive: true }),
    mkdir(paths.configPath, { recursive: true }),
  ]);
  await writeFile(paths.permissionsConfigPath, '{"version":1}\n');
  const store = new CanonicalStore(paths.sqlitePath);
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  await new CanonicalConversationCreationService(store).createEmpty({
    conversationId: "conv_backup",
    commandId: "command_backup_seed",
    now: "2026-09-13T00:00:00.000Z",
  });
  const sourceIdentity = await store.readTimelineStateIdentity();
  assert.ok(sourceIdentity);
  await new CanonicalRunStartService(store).start({
    conversationId: "conv_backup",
    runId: "run_backup",
    agentId: "agent_backup",
    prompt: "pending before backup",
    now: "2026-09-13T00:00:00.500Z",
  });
  const result = await new CanonicalPortableBackupService(store, paths).create(
    "2026-09-13T00:00:01.000Z",
  );
  const persisted = portableBackupManifestSchema.parse(
    JSON.parse(
      await readFile(join(result.backupPath, "manifest.json"), "utf8"),
    ),
  );
  assert.deepEqual(persisted, result.manifest);
  const entriesBytes = await readFile(join(result.backupPath, "entries.json"));
  assert.equal(
    result.manifest.entriesManifestDigest,
    `sha256:${createHash("sha256").update(entriesBytes).digest("hex")}`,
  );
  const entries = JSON.parse(entriesBytes.toString()) as {
    kind: string;
    relativeLocator: string;
  }[];
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["database", "permission_file"],
  );
  const verifier = new CanonicalBackupVerifier();
  assert.deepEqual(await verifier.verify(result.backupPath), result.manifest);
  const inspection = new CanonicalBackupInspectionService(paths);
  assert.deepEqual(
    await inspection.inspect(result.manifest.backupId),
    result.manifest,
  );
  assert.throws(() => inspection.inspect("backup_../escape"), /invalid/);

  const postBackup = await new CanonicalRunTimelineService(store).append({
    conversationId: "conv_backup",
    runId: "run_backup",
    commandId: "post-backup-effect-evidence",
    now: "2026-09-13T00:00:01.500Z",
    actor: { kind: "worker" },
    cause: { kind: "post_backup_external_effect" },
    entries: [
      {
        entryId: "entry_post_backup",
        kind: "tool_result",
        inlineContent: { externalCounter: "incremented" },
      },
    ],
  });
  assert.equal(postBackup.kind, "committed");

  const restoreService = new CanonicalRestoreStagingService(paths);
  const staged = await restoreService.stage({
    backupId: result.manifest.backupId,
    oldRuntimeIsolation: "unproven",
    now: "2026-09-13T00:00:02.000Z",
  });
  assert.equal(staged.promotion.dispatchState, "disabled");
  assert.equal(staged.promotion.quarantinedRunCount, 1);
  assert.notEqual(
    staged.promotion.promotedExecutionIncarnationId,
    sourceIdentity.executionIncarnationId,
  );
  assert.equal(
    await readFile(
      join(staged.restorePath, "payload", "config", "permissions.json"),
      "utf8",
    ),
    '{"version":1}\n',
  );
  const stagedDatabase = new DatabaseSync(
    join(staged.restorePath, "database.sqlite"),
    { readOnly: true },
  );
  const restoredIdentity = stagedDatabase
    .prepare(
      `SELECT execution_incarnation_id FROM state_identity WHERE singleton = 1`,
    )
    .get() as { execution_incarnation_id: string };
  const admission = stagedDatabase
    .prepare(
      `SELECT dispatch_state, restore_id FROM runtime_admission WHERE singleton = 1`,
    )
    .get() as { dispatch_state: string; restore_id: string };
  const restoredRun = stagedDatabase
    .prepare(
      `SELECT effective_state, foreground_owned FROM run_controls WHERE run_id = ?`,
    )
    .get("run_backup") as {
    effective_state: string;
    foreground_owned: number;
  };
  stagedDatabase.close();
  assert.equal(
    restoredIdentity.execution_incarnation_id,
    staged.promotion.promotedExecutionIncarnationId,
  );
  assert.equal(admission.dispatch_state, "disabled");
  assert.equal(admission.restore_id, staged.promotion.restoreId);
  assert.equal(restoredRun.effective_state, "recovery_required");
  assert.equal(restoredRun.foreground_owned, 0);
  const stagedStore = new CanonicalStore(
    join(staged.restorePath, "database.sqlite"),
  );
  await stagedStore.initialize();
  assert.equal(
    (await stagedStore.readTimelineConversationHead("conv_backup"))?.revision,
    1,
  );
  const blockedStart = await new CanonicalRunStartService(stagedStore).start({
    conversationId: "conv_restored_new",
    runId: "run_restored_new",
    agentId: "agent_restored_new",
    prompt: "must not dispatch",
    now: "2026-09-13T00:00:02.500Z",
  });
  assert.equal(blockedStart.kind, "rejected");
  assert.equal(
    blockedStart.kind === "rejected" && blockedStart.outcome.kind,
    "superseded",
  );
  const forbiddenContinuation = await new CanonicalRunTimelineService(
    stagedStore,
  ).append({
    conversationId: "conv_backup",
    runId: "run_backup",
    commandId: "repeat-post-backup-effect",
    now: "2026-09-13T00:00:03.000Z",
    actor: { kind: "restored_worker" },
    cause: { kind: "unsafe_retry" },
    entries: [
      {
        entryId: "entry_repeated_effect",
        kind: "tool_result",
        inlineContent: { externalCounter: "incremented_again" },
      },
    ],
  });
  assert.equal(forbiddenContinuation.kind, "rejected");
  await stagedStore.close();
  await assert.rejects(
    restoreService.admit(staged.promotion.restoreId),
    /without proven isolation/,
  );
  const isolated = await restoreService.stage({
    backupId: result.manifest.backupId,
    oldRuntimeIsolation: "proven",
    now: "2026-09-13T00:00:04.000Z",
  });
  const admitted = await restoreService.admit(isolated.promotion.restoreId);
  assert.equal(admitted.dispatchState, "admitted");

  await writeFile(
    join(result.backupPath, "policy", "permissions.json"),
    "tampered",
  );
  await assert.rejects(
    verifier.verify(result.backupPath),
    /Backup entry (size|digest) is invalid/,
  );

  const snapshot = new CanonicalStore(
    join(result.backupPath, "database.sqlite"),
  );
  await snapshot.initialize();
  assert.equal(
    (await snapshot.readTimelineConversationHead("conv_backup"))?.revision,
    1,
  );
  await snapshot.close();
});
