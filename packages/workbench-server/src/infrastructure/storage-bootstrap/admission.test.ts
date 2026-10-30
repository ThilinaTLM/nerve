import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  HomeAdmissionError,
  homeAdmissionFailureKind,
  NERVE_HOME_MANIFEST,
} from "@nervekit/contracts/settings";
import {
  readMigrationHome,
  planMigrations,
} from "../migrations/framework/ledger.js";
import { storagePaths } from "./paths.js";
import { inspectNerveHome } from "./state-layout.js";

void test("admission distinguishes invalid metadata, unknown layout and recognized old ledgers without writes", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-admission-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "unknown"), "preserve me");
  await assert.rejects(
    readMigrationHome(storagePaths(home)),
    (e) => homeAdmissionFailureKind(e) === "layout_unrecognized",
  );
  await writeFile(join(home, "manifest.json"), "{broken");
  await assert.rejects(
    readMigrationHome(storagePaths(home)),
    (e) => homeAdmissionFailureKind(e) === "manifest_invalid",
  );
  assert.equal(await readFile(join(home, "manifest.json"), "utf8"), "{broken");
  await rm(join(home, "manifest.json"));
  await mkdir(join(home, "manifest.json"));
  await assert.rejects(
    readMigrationHome(storagePaths(home)),
    (e) => homeAdmissionFailureKind(e) === "manifest_invalid",
  );
  await rm(join(home, "manifest.json"), { recursive: true });
  await writeFile(join(home, "manifest.json"), "{broken");
  const inspection = await inspectNerveHome(home);
  assert.equal(
    inspection.kind === "unsupported" && inspection.failureKind,
    "manifest_invalid",
  );
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({ format: "nerve-home", version: 1 }),
  );
  await mkdir(join(home, "data"));
  const db = new DatabaseSync(join(home, "data", "nerve.sqlite"));
  db.exec(
    "CREATE TABLE storage_migrations (id TEXT, ordinal INTEGER); INSERT INTO storage_migrations VALUES ('0001-nerve-home-v1', 1)",
  );
  await assert.rejects(
    readMigrationHome(storagePaths(home)),
    (e) => homeAdmissionFailureKind(e) === "too_old",
  );
  db.exec("UPDATE storage_migrations SET id = 'unexpected'");
  await assert.rejects(
    readMigrationHome(storagePaths(home)),
    (e) => homeAdmissionFailureKind(e) === "ledger_unexpected",
  );
  db.close();
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify(NERVE_HOME_MANIFEST),
  );
  await assert.rejects(
    readMigrationHome(storagePaths(home)),
    (e) => homeAdmissionFailureKind(e) === "ledger_unexpected",
  );
});

void test("supported manifest versions and invalid ledger diagnostics", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-manifest-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const version of [1, 2]) {
    await writeFile(
      join(home, "manifest.json"),
      JSON.stringify({ ...NERVE_HOME_MANIFEST, version, migrations: [] }),
    );
    assert.equal((await inspectNerveHome(home)).kind, "current");
  }
  assert.throws(
    () =>
      planMigrations(
        {
          ...NERVE_HOME_MANIFEST,
          migrations: [
            {
              id: "unknown",
              checksum: "a".repeat(64),
              appliedAt: new Date().toISOString(),
            },
          ],
        },
        [],
      ),
    (e) => e instanceof HomeAdmissionError && e.kind === "ledger_unexpected",
  );
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({ ...NERVE_HOME_MANIFEST, version: 3 }),
  );
  const result = await inspectNerveHome(home);
  assert.ok(result.kind === "unsupported" && result.reason.includes("1 or 2"));
});
