import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { portableBackupManifestSchema } from "@nervekit/contracts/storage";
import { CanonicalConversationCreationService } from "../../../src/domains/conversations/timeline/canonical-conversation-creation.service.js";
import { CanonicalBackupInspectionService } from "../../../src/domains/storage/canonical-backup-inspection.service.js";
import { CanonicalBackupVerifier } from "../../../src/domains/storage/canonical-backup-verifier.js";
import { CanonicalPortableBackupService } from "../../../src/domains/storage/canonical-portable-backup.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";
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
    0,
  );
  await snapshot.close();
});
