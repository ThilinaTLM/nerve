import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyStorageMigrationPlan,
  inspectStorageMigrationPlan,
} from "../../../src/infrastructure/storage-migrations/public-api.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/initialize.js";

test("public migration adapters fingerprint and revalidate a current home", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-migration-api-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const storage = await initializeStorage(home);
  await storage.canonicalStore.close();

  const plan = await inspectStorageMigrationPlan(home);
  assert.equal(plan.outcome, "current");
  assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(plan.steps.length, 10);
  assert.ok(plan.steps.every((step) => step.status === "applied"));

  const result = await applyStorageMigrationPlan(home, plan, {
    fingerprint: plan.fingerprint,
    approvedQuarantineIds: [],
  });
  assert.equal(result.outcome, "current");
  assert.equal(result.planFingerprint, plan.fingerprint);
});

test("public migration apply rejects a stale fingerprint before mutation", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-migration-stale-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const storage = await initializeStorage(home);
  await storage.canonicalStore.close();
  const plan = await inspectStorageMigrationPlan(home);
  await assert.rejects(
    applyStorageMigrationPlan(
      home,
      { ...plan, fingerprint: "0".repeat(64) },
      { fingerprint: "0".repeat(64), approvedQuarantineIds: [] },
    ),
    /plan changed/,
  );
});
