import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  applyStorageMigrationPlan,
  inspectStorageMigrationPlan,
} from "../../../src/infrastructure/storage-migrations/public-api.js";
import { runStorageMigrationWorker } from "../../../src/infrastructure/storage-migrations/worker-client.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/initialize.js";
import { STORAGE_READ_COMPATIBILITY_ID } from "../../../src/infrastructure/storage-migrations/read-compatibility.js";

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

test("released 0.32 homes adopt reader compatibility without sweeping", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "nerve-migration-release-adoption-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const version of ["0.32.0", "0.32.1", "0.32.2"]) {
    const home = join(root, version);
    await cp(resolve("test/fixtures/storage/releases", version), home, {
      recursive: true,
    });
    const sqlitePath = join(home, "data", "nerve.sqlite");
    const database = new DatabaseSync(sqlitePath);
    database.exec("DELETE FROM storage_read_sweeps");
    database
      .prepare(
        "INSERT INTO storage_read_sweeps (build_id, swept_at_ms, quarantined) VALUES (?, 1, 0)",
      )
      .run(`${version}:source`);
    database.close();

    const messages: string[] = [];
    const plan = await inspectStorageMigrationPlan(home);
    assert.equal(plan.outcome, "current");
    const result = await applyStorageMigrationPlan(
      home,
      plan,
      { fingerprint: plan.fingerprint, approvedQuarantineIds: [] },
      { reportProgress: (progress) => messages.push(progress.message) },
    );
    assert.equal(result.outcome, "current");
    assert.equal(
      messages.includes("Checking stored records for readability"),
      false,
    );

    const verified = new DatabaseSync(sqlitePath, { readOnly: true });
    assert.ok(
      verified
        .prepare("SELECT 1 FROM storage_read_sweeps WHERE build_id = ?")
        .get(STORAGE_READ_COMPATIBILITY_ID),
    );
    verified.close();
  }
});

test("worker heartbeat continues during one blocking migration operation", async () => {
  const messages: string[] = [];
  const workerUrl = moduleDataUrl(`
    import { parentPort } from "node:worker_threads";
    const until = Date.now() + 80;
    while (Date.now() < until) {}
    parentPort.postMessage({
      type: "success",
      result: { operation: "inspect", value: {} }
    });
  `);

  await runStorageMigrationWorker(
    { operation: "inspect", home: "/unused" },
    {
      workerUrl,
      reportProgress: (progress) => messages.push(progress.message),
      heartbeat: { delayMs: 0, intervalMs: 10 },
    },
  );

  assert.ok(messages.length >= 2);
  assert.ok(
    messages.every((message) =>
      /^Storage upgrade planning is still running \(\d+s\)$/.test(message),
    ),
  );
  const settledCount = messages.length;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(messages.length, settledCount);
});

test("worker failures reject the migration operation", async () => {
  const workerUrl = moduleDataUrl(`throw new Error("worker exploded");`);
  await assert.rejects(
    runStorageMigrationWorker(
      { operation: "inspect", home: "/unused" },
      { workerUrl },
    ),
    /worker exploded/,
  );
});

test("public migration worker keeps reporting while an operation is outstanding", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-migration-progress-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const storage = await initializeStorage(home);
  await storage.canonicalStore.close();

  const messages: string[] = [];
  const plan = await inspectStorageMigrationPlan(home, {
    reportProgress: (progress) => messages.push(progress.message),
    heartbeat: { delayMs: 0, intervalMs: 10 },
  });

  assert.equal(plan.outcome, "current");
  assert.ok(messages.includes("Inspecting local storage"));
  assert.ok(messages.includes("Storage upgrade plan is ready"));
  assert.ok(
    messages.some((message) =>
      /^Storage upgrade planning is still running \(\d+s\)$/.test(message),
    ),
  );
  const settledCount = messages.length;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(messages.length, settledCount);
});

test("public migration apply forwards worker progress", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-migration-apply-progress-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const storage = await initializeStorage(home);
  await storage.canonicalStore.close();
  const plan = await inspectStorageMigrationPlan(home);
  const messages: string[] = [];

  await applyStorageMigrationPlan(
    home,
    plan,
    { fingerprint: plan.fingerprint, approvedQuarantineIds: [] },
    { reportProgress: (progress) => messages.push(progress.message) },
  );

  assert.deepEqual(messages, [
    "Revalidating storage upgrade plan",
    "Planning storage upgrade",
    "Storage upgrade is complete",
  ]);
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

function moduleDataUrl(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}
