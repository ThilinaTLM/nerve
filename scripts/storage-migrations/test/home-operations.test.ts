import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
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
} from "../home-operations.js";

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

test("clone refuses existing destinations, live source owners and unreadable ownership metadata", async (t) => {
  const root = await temporaryDirectory(t);
  const source = join(root, "source");
  const destination = join(root, "clone");
  await createHome(source, "standard");
  await mkdir(destination);
  await writeFile(join(destination, "keep"), "existing");
  await assert.rejects(
    cloneNerveHome({ source, destination }),
    /already exists/,
  );
  assert.equal(await readFile(join(destination, "keep"), "utf8"), "existing");
  await rm(destination, { recursive: true });
  const daemon = {
    daemonId: "daemon_clone_test",
    pid: process.pid,
    host: "127.0.0.1",
    port: 3747,
    url: "http://127.0.0.1:3747",
    dataDir: source,
    version: "test",
    startedAt: new Date().toISOString(),
  };
  await writeFile(join(source, "daemon.json"), JSON.stringify(daemon));
  await assert.rejects(
    cloneNerveHome({ source, destination }),
    /Stop the source/,
  );
  await writeFile(join(source, "daemon.json"), "malformed");
  await assert.rejects(
    cloneNerveHome({ source, destination }),
    /metadata is invalid/,
  );
  await rm(join(source, "daemon.json"));
  await writeFile(
    `${source}.startup.lock`,
    JSON.stringify({
      format: "nerve-storage-migration-lock",
      version: 1,
      pid: process.pid,
      token: "test-lock",
      acquiredAt: new Date().toISOString(),
    }),
  );
  await assert.rejects(
    cloneNerveHome({ source, destination }),
    /locked by live process/,
  );
  await assert.rejects(readFile(join(destination, "manifest.json")), {
    code: "ENOENT",
  });
});

test("clone rejects linked content, cleans only its partial destination and leaves the source intact", async (t) => {
  const root = await temporaryDirectory(t);
  const source = join(root, "source");
  const destination = join(root, "clone");
  await createHome(source, "standard");
  const manifest = await readFile(join(source, "manifest.json"));
  await writeFile(join(root, "live.txt"), "live");
  await symlink(join(root, "live.txt"), join(source, "linked.txt"));
  await assert.rejects(
    cloneNerveHome({ source, destination }),
    /linked or special/,
  );
  assert.deepEqual(await readFile(join(source, "manifest.json")), manifest);
  assert.equal(await readFile(join(root, "live.txt"), "utf8"), "live");
  await assert.rejects(readFile(join(destination, "manifest.json")), {
    code: "ENOENT",
  });
  await assert.rejects(readFile(`${destination}.startup.lock`), {
    code: "ENOENT",
  });
  await assert.rejects(readFile(`${source}.startup.lock`), { code: "ENOENT" });
});

test("offline clone includes uncheckpointed SQLite WAL state without changing source files", async (t) => {
  const root = await temporaryDirectory(t);
  const source = join(root, "source");
  const destination = join(root, "clone");
  await createHome(source, "standard");
  const databasePath = join(root, "wal-fixture.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('wal-value')",
    );
    // Freeze an offline fixture containing a committed but uncheckpointed WAL.
    for (const suffix of ["", "-wal", "-shm"]) {
      await cp(
        `${databasePath}${suffix}`,
        join(source, "data", `nerve.sqlite${suffix}`),
      );
    }
  } finally {
    database.close();
  }
  const before = await Promise.all(
    ["", "-wal", "-shm"].map((suffix) =>
      readFile(join(source, "data", `nerve.sqlite${suffix}`)),
    ),
  );
  await cloneNerveHome({ source, destination });
  assert.equal(
    readMarker(join(destination, "data", "nerve.sqlite")),
    "wal-value",
  );
  const after = await Promise.all(
    ["", "-wal", "-shm"].map((suffix) =>
      readFile(join(source, "data", `nerve.sqlite${suffix}`)),
    ),
  );
  assert.deepEqual(after, before);
});

test("copy CLI resolves its checkout slot rather than cwd and ignores ambient NERVE_HOME", async (t) => {
  const root = await temporaryDirectory(t);
  const checkout = join(root, "checkout");
  const user = join(root, "user");
  const source = join(user, ".nerve");
  const scripts = join(checkout, "scripts");
  await createHome(source, "standard");
  await writeFile(join(source, "from-default-home.txt"), "source");
  await mkdir(join(scripts, "storage-migrations"), { recursive: true });
  await mkdir(join(scripts, "development"), { recursive: true });
  await writeFile(
    join(checkout, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  await cp(
    join(repo, "scripts/development/storage-slot.mjs"),
    join(scripts, "development/storage-slot.mjs"),
  );
  await cp(
    join(repo, "scripts/storage-migrations/storage-copy.ts"),
    join(scripts, "storage-migrations/storage-copy.ts"),
  );
  await symlink(
    join(repo, "scripts/storage-migrations/home-operations.ts"),
    join(scripts, "storage-migrations/home-operations.ts"),
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      join(scripts, "storage-migrations/storage-copy.ts"),
      "--slot",
      "2",
    ],
    {
      cwd: user,
      env: {
        ...process.env,
        HOME: user,
        USERPROFILE: user,
        NERVE_HOME: join(root, "must-not-read"),
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(
    await readFile(
      join(checkout, "data/storage-2/from-default-home.txt"),
      "utf8",
    ),
    "source",
  );
  assert.equal(
    JSON.parse(
      await readFile(join(checkout, "data/storage-2/manifest.json"), "utf8"),
    ).homeClass,
    "disposable",
  );
  await assert.rejects(readFile(join(user, "data/storage-2/manifest.json")), {
    code: "ENOENT",
  });
  assert.equal(
    JSON.parse(await readFile(join(source, "manifest.json"), "utf8")).homeClass,
    "standard",
  );
});
