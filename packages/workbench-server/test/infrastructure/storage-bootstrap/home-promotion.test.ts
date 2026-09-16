import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { CanonicalPortableBackupService } from "../../../src/domains/storage/canonical-portable-backup.service.js";
import { CanonicalRestoreStagingService } from "../../../src/domains/storage/canonical-restore-staging.service.js";
import {
  initializeStorage,
  type InitializedStorage,
} from "../../../src/infrastructure/storage-bootstrap/index.js";
import { homePromotionMarkerPath } from "../../../src/infrastructure/storage-bootstrap/home-promotion.js";

async function prepare(parent: string) {
  const home = join(parent, "home");
  const storage = await initializeStorage(home);
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
  const admitted = await restores.admit(staged.promotion.restoreId);
  await restores.requestPromotion({
    promotion: admitted,
    restorePath: staged.restorePath,
    now: "2026-09-14T00:00:02.000Z",
  });
  const rollback = join(
    dirname(home),
    `${basename(home)}.rollback-${admitted.restoreId}`,
  );
  return { home, storage, staged, admitted, rollback };
}

async function cleanup(
  parent: string,
  home: string,
  storage?: InitializedStorage,
) {
  await storage?.canonicalStore.close().catch(() => undefined);
  await rm(parent, { recursive: true, force: true });
  await rm(homePromotionMarkerPath(home), { force: true });
}

test("INV-RESTORE-01 promotes a verified sibling home only during startup", async () => {
  const parent = await mkdtemp(join(tmpdir(), "nerve-home-promotion-"));
  const prepared = await prepare(parent);
  let storage: InitializedStorage | undefined = prepared.storage;
  try {
    assert.equal(dirname(prepared.staged.restorePath), dirname(prepared.home));
    const requestedMarker = JSON.parse(
      await readFile(homePromotionMarkerPath(prepared.home), "utf8"),
    ) as {
      schemaVersion: number;
      operationKind: string;
      verifierKind: string;
      state: string;
    };
    assert.deepEqual(
      {
        schemaVersion: requestedMarker.schemaVersion,
        operationKind: requestedMarker.operationKind,
        verifierKind: requestedMarker.verifierKind,
        state: requestedMarker.state,
      },
      {
        schemaVersion: 2,
        operationKind: "restore",
        verifierKind: "restore_v1",
        state: "requested",
      },
    );
    await storage.canonicalStore.close();
    storage = await initializeStorage(prepared.home);
    const admission =
      await storage.canonicalStore.readTimelineRuntimeAdmission();
    assert.equal(admission?.restoreId, prepared.admitted.restoreId);
    assert.equal(admission?.dispatchState, "admitted");
    assert.equal(
      JSON.parse(await readFile(homePromotionMarkerPath(prepared.home), "utf8"))
        .state,
      "verified",
    );
    assert.equal(
      JSON.parse(
        await readFile(join(prepared.rollback, "manifest.json"), "utf8"),
      ).format,
      "nerve-home",
    );
  } finally {
    await cleanup(parent, prepared.home, storage);
  }
});

for (const failure of ["missing_candidate", "corrupt_candidate"] as const) {
  test(`INV-RESTORE-01 rolls back a ${failure}`, async () => {
    const parent = await mkdtemp(join(tmpdir(), `nerve-promotion-${failure}-`));
    const prepared = await prepare(parent);
    let storage: InitializedStorage | undefined = prepared.storage;
    try {
      await storage.canonicalStore.close();
      storage = undefined;
      if (failure === "missing_candidate") {
        await rm(prepared.staged.restorePath, { recursive: true, force: true });
      } else {
        await writeFile(
          join(prepared.staged.restorePath, "promotion.json"),
          '{"corrupted":true}\n',
        );
      }
      await assert.rejects(initializeStorage(prepared.home));
      storage = await initializeStorage(prepared.home);
      const admission =
        await storage.canonicalStore.readTimelineRuntimeAdmission();
      assert.notEqual(admission?.restoreId, prepared.admitted.restoreId);
      await assert.rejects(readFile(homePromotionMarkerPath(prepared.home)));
    } finally {
      await cleanup(parent, prepared.home, storage);
    }
  });
}

for (const crashPoint of ["old_home_renamed", "candidate_promoted"] as const) {
  test(`INV-RESTORE-01 resumes after ${crashPoint} crash`, async () => {
    const parent = await mkdtemp(
      join(tmpdir(), `nerve-promotion-${crashPoint}-`),
    );
    const prepared = await prepare(parent);
    let storage: InitializedStorage | undefined = prepared.storage;
    try {
      await storage.canonicalStore.close();
      await rename(prepared.home, prepared.rollback);
      if (crashPoint === "candidate_promoted") {
        await rename(prepared.staged.restorePath, prepared.home);
      }
      storage = await initializeStorage(prepared.home);
      assert.equal(
        (await storage.canonicalStore.readTimelineRuntimeAdmission())
          ?.restoreId,
        prepared.admitted.restoreId,
      );
      assert.equal(
        JSON.parse(
          await readFile(homePromotionMarkerPath(prepared.home), "utf8"),
        ).state,
        "verified",
      );
    } finally {
      await cleanup(parent, prepared.home, storage);
    }
  });
}
