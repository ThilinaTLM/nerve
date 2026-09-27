import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  cloneNerveHome,
  dryRunNerveHomeMigration,
  restoreNerveHome,
} from "./home-operations.js";

async function temporaryDirectory(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "nerve-home-tooling-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function createHome(root: string, homeClass: "standard" | "disposable") {
  await mkdir(join(root, "data"), { recursive: true });
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(
    join(root, "manifest.json"),
    `${JSON.stringify({ format: "nerve-home", version: 2, homeClass })}\n`,
  );
  new DatabaseSync(join(root, "data", "nerve.sqlite")).close();
}

function writeMarkerDatabase(path: string, marker: string) {
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE marker (value TEXT NOT NULL)");
  database.prepare("INSERT INTO marker VALUES (?)").run(marker);
  database.close();
}

function readMarker(path: string): string {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return (
      database.prepare("SELECT value FROM marker").get() as { value: string }
    ).value;
  } finally {
    database.close();
  }
}

test("clone excludes backups and work, then marks the destination disposable", async (t) => {
  const root = await temporaryDirectory(t);
  const source = join(root, "source");
  const destination = join(root, "clone");
  await createHome(source, "standard");
  await mkdir(join(source, "backups", "storage", "old"), { recursive: true });
  await writeFile(join(source, "backups", "storage", "old", "ignored"), "old");
  await mkdir(join(source, "migrations", "work", "partial"), {
    recursive: true,
  });
  await writeFile(
    join(source, "migrations", "work", "partial", "ignored"),
    "partial",
  );
  await writeFile(join(source, "kept.txt"), "kept");

  await cloneNerveHome({ source, destination });

  assert.deepEqual(
    JSON.parse(await readFile(join(destination, "manifest.json"), "utf8")),
    {
      format: "nerve-home",
      version: 2,
      homeClass: "disposable",
    },
  );
  assert.equal(await readFile(join(destination, "kept.txt"), "utf8"), "kept");
  await assert.rejects(
    readFile(join(destination, "backups", "storage", "old", "ignored")),
  );
  await assert.rejects(
    readFile(join(destination, "migrations", "work", "partial", "ignored")),
  );
});

test("dry run requires disposable storage and never promotes its workspace", async (t) => {
  const root = await temporaryDirectory(t);
  const standard = join(root, "standard");
  const disposable = join(root, "disposable");
  await createHome(standard, "standard");
  await createHome(disposable, "disposable");

  await assert.rejects(
    dryRunNerveHomeMigration({ home: standard, appVersion: "test" }),
    /requires a disposable/,
  );
  const result = await dryRunNerveHomeMigration({
    home: disposable,
    appVersion: "test",
  });
  assert.equal(result.outcome, "pending");
  assert.ok(result.appliedIds.length > 0);
  assert.equal(result.sweepFailures, 0);
  const live = new DatabaseSync(join(disposable, "data", "nerve.sqlite"), {
    readOnly: true,
  });
  try {
    const row = live
      .prepare(
        "SELECT count(*) AS count FROM sqlite_master WHERE name = 'storage_migrations'",
      )
      .get() as { count: number };
    assert.equal(row.count, 0);
  } finally {
    live.close();
  }
  assert.deepEqual(
    await readdir(join(disposable, "migrations", "work")).catch(() => []),
    [],
  );
});

test("restore requires exact confirmation and exports current storage before journaled replacement", async (t) => {
  const root = await temporaryDirectory(t);
  const home = join(root, "home");
  await createHome(home, "standard");
  await rm(join(home, "data", "nerve.sqlite"));
  writeMarkerDatabase(join(home, "data", "nerve.sqlite"), "current");
  await writeFile(join(home, "config", "value.json"), '"current"\n');
  const snapshot = join(home, "backups", "storage", "snapshot-one");
  await mkdir(join(snapshot, "config"), { recursive: true });
  writeMarkerDatabase(join(snapshot, "nerve.sqlite"), "snapshot");
  await writeFile(join(snapshot, "config", "value.json"), '"snapshot"\n');

  await assert.rejects(
    restoreNerveHome({
      home,
      snapshot: "snapshot-one",
      confirm: async () => "RESTORE something-else",
    }),
    /confirmation did not match/,
  );
  assert.equal(readMarker(join(home, "data", "nerve.sqlite")), "current");

  let warning = "";
  const result = await restoreNerveHome({
    home,
    snapshot: "snapshot-one",
    confirm: async (expected, message) => {
      warning = message;
      return expected;
    },
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });
  assert.match(warning, /may discard writes/);
  assert.match(warning, /exported to a new storage snapshot first/);
  assert.equal(readMarker(join(home, "data", "nerve.sqlite")), "snapshot");
  assert.equal(
    await readFile(join(home, "config", "value.json"), "utf8"),
    '"snapshot"\n',
  );
  assert.equal(
    readMarker(join(result.exportedCurrentStorage, "nerve.sqlite")),
    "current",
  );
});
