import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { CanonicalPortableBackupService } from "../../../src/domains/storage/canonical-portable-backup.service.js";
import { CanonicalRestoreStagingService } from "../../../src/domains/storage/canonical-restore-staging.service.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { homePromotionMarkerPath } from "../../../src/infrastructure/storage-bootstrap/home-promotion.js";

test("INV-RESTORE-01 promotes a verified sibling home only during startup", async () => {
  const parent = await mkdtemp(join(tmpdir(), "nerve-home-promotion-"));
  const home = join(parent, "home");
  let storage = await initializeStorage(home);
  try {
    const backup = await new CanonicalPortableBackupService(
      storage.canonicalStore,
      storage.paths,
    ).create("2026-09-14T00:00:00.000Z");
    const restores = new CanonicalRestoreStagingService(storage.paths);
    const staged = await restores.stage({
      backupId: backup.manifest.backupId,
      oldRuntimeIsolation: "proven",
      now: "2026-09-14T00:00:01.000Z",
    });
    assert.equal(dirname(staged.restorePath), dirname(home));
    assert.notEqual(staged.restorePath, home);
    const admitted = await restores.admit(staged.promotion.restoreId);
    await restores.requestPromotion({
      promotion: admitted,
      restorePath: staged.restorePath,
      now: "2026-09-14T00:00:02.000Z",
    });
    assert.equal(
      JSON.parse(await readFile(homePromotionMarkerPath(home), "utf8")).state,
      "requested",
    );
    await storage.canonicalStore.close();
    storage = await initializeStorage(home);
    const admission =
      await storage.canonicalStore.readTimelineRuntimeAdmission();
    assert.equal(admission?.restoreId, admitted.restoreId);
    assert.equal(admission?.dispatchState, "admitted");
    assert.equal(
      JSON.parse(await readFile(homePromotionMarkerPath(home), "utf8")).state,
      "verified",
    );
    const rollback = join(
      dirname(home),
      `${basename(home)}.rollback-${admitted.restoreId}`,
    );
    assert.equal(
      JSON.parse(await readFile(join(rollback, "manifest.json"), "utf8"))
        .format,
      "nerve-home",
    );
  } finally {
    await storage.canonicalStore.close().catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
    await rm(homePromotionMarkerPath(home), { force: true });
  }
});
