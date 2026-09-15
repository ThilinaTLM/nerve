import assert from "node:assert/strict";
import test from "node:test";
import {
  deletionIntentSchema,
  homePromotionMarkerSchema,
  legacyRestorePromotionMarkerSchema,
  restorePromotionSchema,
} from "../../src/domains/storage/durable-recovery.js";

const hash = `sha256:${"a".repeat(64)}`;

test("INV-RESTORE-01 requires a distinct promoted execution incarnation", () => {
  const value = {
    schemaVersion: 1,
    restoreId: "restore_one",
    backupId: "backup_one",
    namespaceId: "namespace_one",
    priorExecutionIncarnationId: "incarnation_old",
    promotedExecutionIncarnationId: "incarnation_new",
    oldRuntimeIsolation: "proven",
    dispatchState: "quarantined",
    quarantinedRunCount: 2,
    quarantineManifestDigest: hash,
    promotedAt: "2026-09-12T00:00:00.000Z",
  };
  assert.equal(restorePromotionSchema.safeParse(value).success, true);
  assert.equal(
    restorePromotionSchema.safeParse({
      ...value,
      promotedExecutionIncarnationId: "incarnation_old",
    }).success,
    false,
  );
  assert.equal(
    restorePromotionSchema.safeParse({
      ...value,
      oldRuntimeIsolation: "unproven",
      dispatchState: "quarantined",
    }).success,
    false,
  );
});

test("INV-RESTORE-01 uses a generic promotion descriptor and retains a versioned legacy reader", () => {
  const shared = {
    liveHomeName: "home",
    candidateHomeName: "home.candidate",
    rollbackHomeName: "home.rollback",
    requestedAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };
  assert.equal(
    homePromotionMarkerSchema.safeParse({
      schemaVersion: 2,
      operationKind: "legacy_v2_migration",
      operationId: "migration_one",
      candidateEvidenceId: "legacy-v2-import.json",
      candidateEvidenceDigest: hash,
      sourceAuthorityId: "legacy-v2:home",
      verifierKind: "legacy_v2_canonical_v1",
      rollbackDisposition: "archive_under_live",
      archiveRelativePath: "backups/legacy-v2-one",
      state: "requested",
      ...shared,
    }).success,
    true,
  );
  assert.equal(
    legacyRestorePromotionMarkerSchema.safeParse({
      schemaVersion: 1,
      restoreId: "restore_one",
      backupId: "backup_one",
      candidatePromotionDigest: hash,
      state: "requested",
      ...shared,
    }).success,
    true,
  );
});

test("INV-DELETE-01 keeps uncertainty acknowledgement explicit", () => {
  const intent = deletionIntentSchema.parse({
    schemaVersion: 1,
    conversationId: "conv_one",
    commandId: "command_delete",
    fenceRevision: 8,
    phase: "settling_execution",
    uncertaintyAcknowledged: false,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  });
  assert.equal(intent.uncertaintyAcknowledged, false);
});
