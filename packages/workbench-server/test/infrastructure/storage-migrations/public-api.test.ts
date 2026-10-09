import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

import { acquireStorageStartupLock } from "../../../src/infrastructure/storage-bootstrap/startup-lock.js";
import { cloneNerveHome } from "../../../../../scripts/storage-migrations/home-operations.js";
import { prepareDevelopmentSlot } from "../../../../../scripts/development/storage-preparation.js";
import { resolveStorageSlot } from "../../../../../scripts/development/storage-slot.mjs";

test("public migration adapters fingerprint and revalidate a current home", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-migration-api-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const storage = await initializeStorage(home);
  await storage.canonicalStore.close();

  const plan = await inspectStorageMigrationPlan(home);
  assert.equal(plan.outcome, "current");
  assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(plan.steps.length, 12);
  assert.equal(plan.steps.at(-1)?.id, "0012-run-initial-input-lookup");
  assert.ok(plan.steps.every((step) => step.status === "applied"));

  const result = await applyStorageMigrationPlan(home, plan, {
    fingerprint: plan.fingerprint,
    approvedQuarantineIds: [],
  });
  assert.equal(result.outcome, "current");
  assert.equal(result.planFingerprint, plan.fingerprint);
});

test("released 0.32 homes are revalidated after reader contract changes", async (t) => {
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
    const priorCanonicalReceipts = database
      .prepare("SELECT * FROM schema_migrations ORDER BY version")
      .all();
    const priorManagedReceipts = database
      .prepare("SELECT * FROM storage_migrations ORDER BY ordinal")
      .all();
    database.exec("DELETE FROM storage_read_sweeps");
    database
      .prepare(
        "INSERT INTO storage_read_sweeps (build_id, swept_at_ms, quarantined) VALUES (?, 1, 0)",
      )
      .run(`${version}:source`);
    database.close();

    const messages: string[] = [];
    const plan = await inspectStorageMigrationPlan(home);
    assert.equal(plan.outcome, "pending");
    assert.deepEqual(
      plan.steps
        .filter((step) => step.status === "pending")
        .map((step) => step.id),
      ["0011-agent-intervention-obligations", "0012-run-initial-input-lookup"],
    );
    const result = await applyStorageMigrationPlan(
      home,
      plan,
      { fingerprint: plan.fingerprint, approvedQuarantineIds: [] },
      { reportProgress: (progress) => messages.push(progress.message) },
    );
    assert.equal(result.outcome, "migrated");
    assert.equal(messages.includes("Verifying upgraded storage"), true);

    const verified = new DatabaseSync(sqlitePath, { readOnly: true });
    assert.ok(
      verified
        .prepare("SELECT 1 FROM storage_read_sweeps WHERE build_id = ?")
        .get(STORAGE_READ_COMPATIBILITY_ID),
    );
    assert.equal(
      verified
        .prepare("SELECT origin FROM storage_migrations WHERE id = ?")
        .get("0011-agent-intervention-obligations")?.origin,
      "applied",
    );
    assert.equal(
      verified
        .prepare("SELECT origin FROM storage_migrations WHERE id = ?")
        .get("0012-run-initial-input-lookup")?.origin,
      "applied",
    );
    const canonicalReceipts = verified
      .prepare("SELECT * FROM schema_migrations ORDER BY version")
      .all();
    assert.deepEqual(
      canonicalReceipts.slice(0, priorCanonicalReceipts.length),
      priorCanonicalReceipts,
    );
    assert.equal(canonicalReceipts.at(-1)?.version, 8);
    assert.equal(canonicalReceipts.at(-1)?.name, "run-initial-input-lookup-v8");
    assert.deepEqual(
      verified
        .prepare("SELECT * FROM storage_migrations ORDER BY ordinal")
        .all()
        .slice(0, priorManagedReceipts.length),
      priorManagedReceipts,
    );
    const index = verified
      .prepare("PRAGMA index_list(conversation_records)")
      .all()
      .find((row) => row.name === "conversation_records_initial_input_lookup");
    assert.equal(index?.unique, 0);
    assert.equal(index?.partial, 1);
    assert.match(
      String(
        verified
          .prepare(
            "SELECT sql FROM sqlite_master WHERE name = 'agent_async_obligations'",
          )
          .get()?.sql,
      ),
      /user_intervention/,
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

test("fresh disposable initialization is opt-in and never reclassifies existing standard storage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nerve-storage-home-class-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const standard = join(root, "standard");
  const disposable = join(root, "disposable");
  for (const [home, options, expected] of [
    [standard, {}, "standard"],
    [disposable, { freshHomeClass: "disposable" as const }, "disposable"],
    [standard, { freshHomeClass: "disposable" as const }, "standard"],
  ] as const) {
    const storage = await initializeStorage(home, options);
    await storage.canonicalStore.close();
    const manifest = JSON.parse(
      await readFile(join(home, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.homeClass, expected);
    const plan = await inspectStorageMigrationPlan(home);
    assert.equal(plan.outcome, "current");
  }
});

test("slot preparation uses normal initialization and never upgrades or reclassifies existing copies", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nerve-dev-preparation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const slot = resolveStorageSlot([], root);
  await prepareDevelopmentSlot(slot);
  assert.equal(
    JSON.parse(await readFile(join(slot.home, "manifest.json"), "utf8"))
      .homeClass,
    "standard",
  );
  const database = await readFile(join(slot.home, "data", "nerve.sqlite"));
  await prepareDevelopmentSlot(slot);
  assert.deepEqual(
    await readFile(join(slot.home, "data", "nerve.sqlite")),
    database,
  );
  for (const manifest of [
    { format: "nerve-home", version: 1 },
    { format: "nerve-home", version: 2, homeClass: "standard" },
    { format: "nerve-home", version: 2, homeClass: "disposable" },
  ]) {
    const raw = JSON.stringify(manifest);
    await writeFile(join(slot.home, "manifest.json"), raw);
    await prepareDevelopmentSlot(slot);
    assert.equal(await readFile(join(slot.home, "manifest.json"), "utf8"), raw);
    assert.deepEqual(
      await readFile(join(slot.home, "data", "nerve.sqlite")),
      database,
    );
  }
});

test("daemon-owned startup lock covers the gap from storage initialization to published ownership", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nerve-startup-copy-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "source");
  const destination = join(root, "copy");
  const startupLock = await acquireStorageStartupLock(home);
  t.after(() => startupLock.release());
  const storage = await initializeStorage(home, { startupLock });
  await storage.canonicalStore.close();
  // initializeStorage returned, but the daemon hasn't advertised its lease.
  await assert.rejects(
    cloneNerveHome({ source: home, destination }),
    /locked by live process/,
  );
  await writeFile(
    join(home, "daemon.json"),
    JSON.stringify({
      daemonId: "daemon_lock_test",
      pid: process.pid,
      host: "127.0.0.1",
      port: 3747,
      url: "http://127.0.0.1:3747",
      dataDir: home,
      version: "test",
      startedAt: new Date().toISOString(),
    }),
  );
  await startupLock.release();
  await assert.rejects(
    cloneNerveHome({ source: home, destination }),
    /Stop the source/,
  );
  await assert.rejects(readFile(join(destination, "manifest.json")), {
    code: "ENOENT",
  });
});
