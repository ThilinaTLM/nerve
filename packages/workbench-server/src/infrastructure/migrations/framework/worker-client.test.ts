import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { NERVE_HOME_MANIFEST } from "@nervekit/contracts/settings";
import { MIGRATION_METADATA } from "./registry-metadata.js";
import { runMigrationsInWorker } from "./worker-client.js";
import { planMigrations } from "./ledger.js";
import { acquireStorageHomeLock } from "../../storage-bootstrap/home-lock.js";

const missingWorker = new URL("./nonexistent-worker.js", import.meta.url);
const migrations = MIGRATION_METADATA.map((entry) => ({
  id: entry.step.id,
  checksum: entry.checksum,
  appliedAt: new Date().toISOString(),
}));

async function homeFor(
  t: TestContext,
  value: unknown = {
    ...NERVE_HOME_MANIFEST,
    migrations,
  },
): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "nerve-migration-startup-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  if (value !== null)
    await writeFile(join(home, "manifest.json"), JSON.stringify(value));
  return home;
}

void test("current startup bypasses workers and retains the caller's lock", async (t) => {
  const home = await homeFor(t);
  const lock = await acquireStorageHomeLock(home);
  t.after(() => lock.release());
  const before = await readFile(join(home, "manifest.json"));
  assert.deepEqual(
    await runMigrationsInWorker({ home, workerUrl: missingWorker }),
    {
      fresh: false,
      pending: [],
    },
  );
  assert.deepEqual(await readFile(join(home, "manifest.json")), before);
  await assert.rejects(acquireStorageHomeLock(home, { timeoutMs: 0 }));
});

void test("current startup imports neither migration implementations nor SQLite", async (t) => {
  const home = await homeFor(t);
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'node:sqlite' || specifier.includes('steps/') || specifier.includes('/runner.') || specifier.startsWith('./runner.'))
        throw new Error('Heavy migration import: ' + specifier);
      return next(specifier, context);
    }});
    const { runMigrationsInWorker } = await import(${JSON.stringify(new URL("./worker-client.ts", import.meta.url).href)});
    await runMigrationsInWorker({ home: ${JSON.stringify(home)}, workerUrl: new URL(${JSON.stringify(missingWorker.href)}) });
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

void test("validated current startup recovers only marker-authorized cleanup", async (t) => {
  const home = await homeFor(t);
  const scratch = join(home, "migrations/work", migrations[0].id);
  await mkdir(scratch, { recursive: true });
  const checkpoint = join(scratch, "checkpoint");
  await writeFile(checkpoint, "keep without marker");
  await runMigrationsInWorker({ home, workerUrl: missingWorker });
  assert.equal(await readFile(checkpoint, "utf8"), "keep without marker");
  const artifacts = [
    checkpoint,
    join(home, "migrations/work/manifest.before.json"),
    join(home, "migrations/last-failure.json"),
    join(home, "migrations/work/cleanup-needed.json"),
  ];
  for (const path of artifacts) await writeFile(path, "{}");
  await runMigrationsInWorker({ home, workerUrl: missingWorker });
  for (const path of artifacts)
    await assert.rejects(readFile(path), { code: "ENOENT" });
});

void test("invalid ledgers fail before cleanup or worker startup", async (t) => {
  for (const ledger of [
    [{ ...migrations[0], id: "0001-unknown" }],
    [...migrations, migrations[0]],
    [{ ...migrations[0], id: "../outside" }],
  ]) {
    const home = await homeFor(t, {
      ...NERVE_HOME_MANIFEST,
      migrations: ledger,
    });
    const marker = join(home, "migrations/work/cleanup-needed.json");
    await mkdir(join(home, "migrations/work"), { recursive: true });
    await writeFile(marker, "{}");
    await assert.rejects(
      runMigrationsInWorker({ home, workerUrl: missingWorker }),
      /Unknown or out-of-order|Run Nerve 0.34.1 first/,
    );
    assert.equal(await readFile(marker, "utf8"), "{}");
  }
});

void test("shared planner preserves released checksum enforcement and draft tolerance", () => {
  const registry = MIGRATION_METADATA.map((entry) => ({
    ...entry,
    stage: "released" as const,
    releasedIn: "test",
  }));
  const manifest = {
    ...NERVE_HOME_MANIFEST,
    migrations: migrations.map((entry) => ({
      ...entry,
      checksum: "f".repeat(64),
    })),
  };
  assert.throws(
    () => planMigrations(manifest, registry),
    /Released migration checksum mismatch/,
  );
  assert.deepEqual(
    planMigrations(
      manifest,
      registry.map((entry) => ({ ...entry, stage: "draft" as const })),
    ),
    [],
  );
});

void test("fresh, legacy, and pending homes still run the worker and forward messages", async (t) => {
  const workerUrl = new URL(
    `data:text/javascript,${encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    parentPort.postMessage({ type: 'log', line: 'worker ran' });
    parentPort.postMessage({ type: 'progress', progress: { step: 'test', description: 'test', phase: 'run' } });
    parentPort.postMessage({ type: 'done', result: { fresh: true, pending: ['worker-result'] } });
  `)}`,
  );
  for (const value of [
    null,
    { format: "nerve-home", version: 1 },
    { ...NERVE_HOME_MANIFEST, migrations: [] },
  ]) {
    const home = await homeFor(t, value);
    const logs: string[] = [];
    const phases: string[] = [];
    assert.deepEqual(
      await runMigrationsInWorker({
        home,
        workerUrl,
        onLog: (line) => logs.push(line),
        onProgress: (progress) => phases.push(progress.phase),
      }),
      { fresh: true, pending: ["worker-result"] },
    );
    assert.deepEqual(logs, ["worker ran"]);
    assert.deepEqual(phases, ["run"]);
  }
});

void test("malformed and unsupported manifests fail closed", async (t) => {
  for (const value of [
    { format: "other", version: 2 },
    { format: "nerve-home", version: 999 },
  ]) {
    const home = await homeFor(t, value);
    await assert.rejects(
      runMigrationsInWorker({ home, workerUrl: missingWorker }),
      /Run Nerve 0.34.1 first/,
    );
  }
  const home = await homeFor(t);
  await writeFile(join(home, "manifest.json"), "{");
  await assert.rejects(
    runMigrationsInWorker({ home, workerUrl: missingWorker }),
    /Run Nerve 0.34.1 first/,
  );
});
