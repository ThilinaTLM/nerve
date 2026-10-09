import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { runMigrations } from "./runner.js";
import { acquireStorageHomeLock } from "../../storage-bootstrap/home-lock.js";
import { defineStep, type RegisteredStep } from "./step.js";
import { checkMigrationLock, hashStepFolder } from "./lock.js";

const checksum = "a".repeat(64);
const baselineIds = [
  "0001-nerve-home-v1",
  "0002-atomic-run-lifecycle-work",
  "0003-authoritative-run-lifecycle",
  "0004-convert-run-lifecycle",
  "0005-async-subagent-completions",
  "0006-explore-agent-names",
  "0007-agent-async-obligations",
  "0008-tool-result-payload-reference",
  "0009-agent-async-obligations-backfill",
  "0010-deletion-indexes",
];

async function temporaryHome(t: TestContext): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "nerve-migrations-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

async function baseline(home: string, ids = baselineIds): Promise<void> {
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({ format: "nerve-home", version: 1 }),
  );
  await mkdir(join(home, "data"));
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    db.exec("CREATE TABLE storage_migrations (id TEXT, ordinal INTEGER)");
    ids.forEach((id, index) =>
      db
        .prepare("INSERT INTO storage_migrations VALUES (?, ?)")
        .run(id, index + 1),
    );
  } finally {
    db.close();
  }
}

async function manifest(home: string) {
  return JSON.parse(await readFile(join(home, "manifest.json"), "utf8"));
}

function entry(
  id: string,
  run: RegisteredStep["step"]["run"],
  verify?: RegisteredStep["step"]["verify"],
): RegisteredStep {
  return {
    step: defineStep({ id, description: id, run, verify }),
    checksum,
    stage: "released",
    releasedIn: "0.35.0",
  };
}

void test("fresh homes record latest steps without executing; dry-run does not write", async (t) => {
  const home = await temporaryHome(t);
  const registry = [
    entry("0001-example", async () => {
      assert.fail("fresh step ran");
    }),
  ];
  assert.deepEqual(await runMigrations(home, { registry, dryRun: true }), {
    fresh: true,
    pending: [],
  });
  await assert.rejects(readFile(join(home, "manifest.json")), {
    code: "ENOENT",
  });
  await runMigrations(home, { registry });
  assert.equal((await manifest(home)).version, 2);
  assert.equal((await manifest(home)).migrations[0].checksum, checksum);
  await runMigrations(home, { registry });
});

void test("failure retains checkpoints, ledger commits only after verify, rerun resumes", async (t) => {
  const home = await temporaryHome(t);
  await baseline(home);
  let runs = 0;
  let fail = true;
  const registry = [
    entry(
      "0001-example",
      async (ctx) => {
        runs++;
        assert.deepEqual(Object.keys(ctx).sort(), [
          "log",
          "paths",
          "progress",
          "scratchDir",
        ]);
        if (runs === 1)
          await writeFile(join(ctx.scratchDir, "checkpoint"), "ready");
        else
          assert.equal(
            await readFile(join(ctx.scratchDir, "checkpoint"), "utf8"),
            "ready",
          );
        ctx.log("running");
        ctx.progress("import", 1, 2);
        // Simulate replacement, so resume must rely on manifest admission, not old DB.
        await rm(ctx.paths.sqlitePath, { force: true });
      },
      async () => {
        if (fail) throw new Error("verification failed");
      },
    ),
  ];
  await assert.rejects(
    runMigrations(home, { registry }),
    /verification failed.*\nMigration failure report:/,
  );
  assert.deepEqual((await manifest(home)).migrations, []);
  const failure = JSON.parse(
    await readFile(join(home, "migrations/last-failure.json"), "utf8"),
  );
  assert.equal(failure.step, "0001-example");
  assert.equal(failure.phase, "verify");
  fail = false;
  await runMigrations(home, { registry });
  assert.equal(runs, 2);
  assert.equal((await manifest(home)).migrations.length, 1);
  await assert.rejects(
    readFile(join(home, "migrations/work/0001-example/checkpoint")),
    { code: "ENOENT" },
  );
  await assert.rejects(readFile(join(home, "migrations/last-failure.json")), {
    code: "ENOENT",
  });
  await runMigrations(home, { registry });
  assert.equal(runs, 2);
});

void test("rejects unsupported baselines without modifying SQLite", async (t) => {
  for (const ids of [
    baselineIds.slice(0, 9),
    [...baselineIds.slice(0, 9), "0010-wrong"],
  ]) {
    const home = await temporaryHome(t);
    await baseline(home, ids);
    const before = await readFile(join(home, "data/nerve.sqlite"));
    await assert.rejects(runMigrations(home), /Run Nerve 0.34.1 first/);
    assert.deepEqual(await readFile(join(home, "data/nerve.sqlite")), before);
  }
  const home = await temporaryHome(t);
  await writeFile(join(home, "unknown"), "old home");
  await assert.rejects(
    runMigrations(home, { dryRun: true }),
    /Run Nerve 0.34.1 first/,
  );
  await assert.rejects(readFile(join(home, "migrations/last-failure.json")), {
    code: "ENOENT",
  });
});

void test("ledger rejects unknown IDs and released checksum drift", async (t) => {
  const home = await temporaryHome(t);
  const registry = [entry("0001-example", async () => {})];
  await runMigrations(home, { registry });
  const value = await manifest(home);
  value.migrations[0].checksum = "b".repeat(64);
  await writeFile(join(home, "manifest.json"), JSON.stringify(value));
  await assert.rejects(
    runMigrations(home, { registry }),
    /Released migration checksum mismatch/,
  );
  value.migrations[0].id = "0001-unknown";
  await writeFile(join(home, "manifest.json"), JSON.stringify(value));
  await assert.rejects(
    runMigrations(home, { registry }),
    /Unknown or out-of-order/,
  );
});

void test("lock check freezes released folders, permits draft edits, rejects removed steps", async (t) => {
  const home = await temporaryHome(t);
  const stepsPath = join(home, "steps");
  const folder = join(stepsPath, "0001-example");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "step.ts"), "original");
  const original = await hashStepFolder(folder);
  const registry = [
    { ...entry("0001-example", async () => {}), checksum: original },
  ];
  const lock = {
    "0001-example": {
      checksum: original,
      stage: "released" as const,
      releasedIn: "0.35.0",
    },
  };
  await checkMigrationLock(stepsPath, registry, lock);
  await writeFile(join(folder, "step.ts"), "changed");
  await assert.rejects(
    checkMigrationLock(stepsPath, registry, lock),
    /Released migration changed/,
  );
  await checkMigrationLock(
    stepsPath,
    [{ ...registry[0], stage: "draft", releasedIn: undefined }],
    { "0001-example": { checksum: original, stage: "draft" } },
  );
  await assert.rejects(
    checkMigrationLock(stepsPath, [], lock),
    /IDs must match/,
  );
});

void test("free disk check fails before executing; home locks exclude another writer", async (t) => {
  const home = await temporaryHome(t);
  await baseline(home);
  const migration = entry("0001-example", async () => {
    assert.fail("ran without disk space");
  });
  migration.step = defineStep({
    ...migration.step,
    requiresFreeBytes: Number.MAX_SAFE_INTEGER,
  });
  await assert.rejects(
    runMigrations(home, { registry: [migration] }),
    /free bytes/,
  );
  const failure = JSON.parse(
    await readFile(join(home, "migrations/last-failure.json"), "utf8"),
  );
  assert.equal(failure.phase, "disk-check");
  assert.deepEqual((await manifest(home)).migrations, []);
  const lock = await acquireStorageHomeLock(home);
  try {
    await assert.rejects(
      runMigrations(home, { dryRun: true }),
      /locked by live process/,
    );
  } finally {
    await lock.release();
  }
});
