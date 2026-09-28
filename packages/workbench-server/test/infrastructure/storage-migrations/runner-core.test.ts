import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { acquireStorageHomeLock } from "../../../src/infrastructure/storage-migrations/runner/home-lock.js";
import { createMigrationFiles } from "../../../src/infrastructure/storage-migrations/runner/kit-context.js";
import {
  initializeStorageMigrationLedger,
  recordReadSweep,
  recordStorageMigration,
} from "../../../src/infrastructure/storage-migrations/runner/ledger.js";
import { planStorageMigration } from "../../../src/infrastructure/storage-migrations/runner/planner.js";
import { promoteStorageMigrationWorkspace } from "../../../src/infrastructure/storage-migrations/runner/promotion.js";
import { assertQuarantineImpact } from "../../../src/infrastructure/storage-migrations/runner/quarantine.js";
import { listStorageSnapshots } from "../../../src/infrastructure/storage-migrations/runner/snapshots.js";
import { createStorageMigrationWorkspace } from "../../../src/infrastructure/storage-migrations/runner/workspace.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/paths.js";

const registry = [
  {
    id: "0001-baseline",
    ordinal: 1,
    kind: "schema" as const,
    checksum: "one",
    stage: "released" as const,
  },
  {
    id: "0002-next",
    ordinal: 2,
    kind: "data" as const,
    checksum: "two",
    stage: "final" as const,
  },
];

test("home lock only removes a dead owner's lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-storage-lock-"));
  const home = join(root, "home");
  try {
    const first = await acquireStorageHomeLock(home);
    await assert.rejects(
      acquireStorageHomeLock(home, { timeoutMs: 0 }),
      /locked by live process/,
    );
    await first.release();
    const second = await acquireStorageHomeLock(home);
    await second.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner detects pending, checksum corruption, sweep, and current", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-storage-plan-"));
  const sqlitePath = join(root, "nerve.sqlite");
  const database = new DatabaseSync(sqlitePath);
  try {
    database.exec("CREATE TABLE seed (id INTEGER PRIMARY KEY)");
    assert.deepEqual(
      planStorageMigration({
        sqlitePath,
        registry,
        buildId: "build-a",
        homeClass: "standard",
      }),
      { outcome: "pending", adoptionRequired: false, steps: registry },
    );
    initializeStorageMigrationLedger(database);
    for (const step of registry) {
      recordStorageMigration(database, {
        ...step,
        appVersion: "test",
        appliedAtMs: 1,
        durationMs: 0,
        quarantined: 0,
        origin: "applied",
      });
    }
    assert.deepEqual(
      planStorageMigration({
        sqlitePath,
        registry,
        buildId: "build-a",
        homeClass: "standard",
      }),
      { outcome: "sweep", buildId: "build-a" },
    );
    recordReadSweep(database, {
      buildId: "build-a",
      sweptAtMs: 1,
      quarantined: 0,
    });
    assert.deepEqual(
      planStorageMigration({
        sqlitePath,
        registry,
        buildId: "build-a",
        homeClass: "standard",
      }),
      { outcome: "current" },
    );
    database
      .prepare(
        "UPDATE storage_migrations SET checksum = 'changed' WHERE ordinal = 2",
      )
      .run();
    assert.equal(
      planStorageMigration({
        sqlitePath,
        registry,
        buildId: "build-a",
        homeClass: "standard",
      }).outcome,
      "corrupt",
    );
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("migration files reject symlink traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-migration-files-"));
  const outside = await mkdtemp(join(tmpdir(), "nerve-migration-outside-"));
  try {
    await mkdir(join(root, "home", "data"), { recursive: true });
    await mkdir(join(root, "staging"), { recursive: true });
    await writeFile(join(outside, "secret"), "outside");
    await symlink(outside, join(root, "home", "data", "linked"));
    const files = createMigrationFiles({
      home: join(root, "home"),
      staging: join(root, "staging"),
    });
    await assert.rejects(files.read("data/linked/secret"), /symlink/);
    await assert.rejects(files.exists("data/linked/secret"), /symlink/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("quarantine impact breaker uses record and byte impact", () => {
  assert.doesNotThrow(() =>
    assertQuarantineImpact({
      inputRecords: 100,
      inputBytes: 1024,
      affectedRecords: 20,
      affectedBytes: 1024,
    }),
  );
  assert.throws(
    () =>
      assertQuarantineImpact({
        inputRecords: 100,
        inputBytes: 1024,
        affectedRecords: 21,
        affectedBytes: 1024,
      }),
    /safe impact threshold/,
  );
});

test("snapshot retention keeps three and recent snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-snapshots-"));
  try {
    for (const stamp of [
      "20260101T000000000Z-before-a",
      "20260102T000000000Z-before-b",
      "20260103T000000000Z-before-c",
      "20260104T000000000Z-before-d",
    ]) {
      await mkdir(join(root, stamp));
      await writeFile(join(root, stamp, "nerve.sqlite"), stamp);
    }
    const snapshots = await listStorageSnapshots(root, {
      nowMs: Date.parse("2026-02-01T00:00:00.000Z"),
    });
    assert.deepEqual(
      snapshots.map((snapshot) => snapshot.pruneCandidate),
      [false, false, false, true],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace promotion retains the original database and config", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-storage-promote-"));
  const home = join(root, "home");
  const paths = storagePaths(home);
  await mkdir(paths.dataPath, { recursive: true });
  await mkdir(paths.configPath, { recursive: true });
  await mkdir(paths.migrationsPath, { recursive: true });
  await writeFile(paths.daemonConfigPath, '{"generation":"old"}\n');
  const source = new DatabaseSync(paths.sqlitePath);
  source.exec(
    "CREATE TABLE value (content TEXT); INSERT INTO value VALUES ('old')",
  );
  source.close();
  try {
    const workspace = await createStorageMigrationWorkspace(paths, {
      id: "test-workspace",
    });
    const working = new DatabaseSync(workspace.sqlitePath);
    working.exec("UPDATE value SET content = 'new'");
    working.close();
    await writeFile(
      join(workspace.configPath, "daemon.json"),
      '{"generation":"new"}\n',
    );
    const result = await promoteStorageMigrationWorkspace(
      paths,
      workspace,
      "0002-next",
      { now: () => new Date("2026-01-02T03:04:05.000Z") },
    );
    const live = new DatabaseSync(paths.sqlitePath, { readOnly: true });
    assert.equal(
      (live.prepare("SELECT content FROM value").get() as { content: string })
        .content,
      "new",
    );
    live.close();
    assert.match(await readFile(paths.daemonConfigPath, "utf8"), /new/);
    const backup = new DatabaseSync(join(result.snapshotPath, "nerve.sqlite"), {
      readOnly: true,
    });
    assert.equal(
      (backup.prepare("SELECT content FROM value").get() as { content: string })
        .content,
      "old",
    );
    backup.close();
    assert.match(
      await readFile(
        join(result.snapshotPath, "config", "daemon.json"),
        "utf8",
      ),
      /old/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
