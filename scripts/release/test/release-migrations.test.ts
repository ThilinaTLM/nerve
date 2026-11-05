import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repoRoot } from "../../workspace/repo.ts";
import {
  MIGRATION_LOCK_PATH,
  MIGRATION_METADATA_PATH,
  applyReleaseToLock,
  applyReleaseToMetadataSource,
  planMigrationRelease,
  releaseDraftMigrations,
} from "../release-migrations.ts";

const a = "a".repeat(64);
const b = "b".repeat(64);
const c = "c".repeat(64);

const metadata = `export const MIGRATION_METADATA = Object.freeze([
    {
      step: { id: "0001-old" },
      checksum:
        "${a}",
      stage: "released",
      releasedIn: "0.1.0",
    },
    {
      step: { id: "0002-new" },
      rerunOnChange: true,
      checksum:
        "${b}",
      stage: "draft",
    },
  ]);
`;

void test("only draft steps are planned, and a drifted label is reported", () => {
  const lock = {
    "0001-old": {
      checksum: a,
      stage: "released" as const,
      releasedIn: "0.1.0",
    },
    "0002-new": { checksum: b, stage: "draft" as const },
  };
  assert.deepEqual(planMigrationRelease(lock, new Map([["0002-new", b]])), [
    { id: "0002-new", checksum: b },
  ]);
  assert.deepEqual(planMigrationRelease(lock, new Map([["0002-new", c]])), [
    { id: "0002-new", checksum: c, staleLabel: b },
  ]);
  assert.throws(() => planMigrationRelease(lock, new Map()), /Missing/);
});

void test("lock entries become released with the version and keep a stale label", () => {
  const lock = { "0002-new": { checksum: b, stage: "draft" as const } };
  assert.deepEqual(
    applyReleaseToLock(lock, [{ id: "0002-new", checksum: b }], "0.2.0"),
    { "0002-new": { checksum: b, stage: "released", releasedIn: "0.2.0" } },
  );
  assert.deepEqual(
    applyReleaseToLock(
      lock,
      [{ id: "0002-new", checksum: c, staleLabel: b }],
      "0.2.0",
    ),
    {
      "0002-new": {
        checksum: c,
        stage: "released",
        releasedIn: "0.2.0",
        previousChecksums: [b],
      },
    },
  );
});

void test("metadata source releases only the draft entry and drops rerunOnChange", () => {
  const next = applyReleaseToMetadataSource(
    metadata,
    [{ id: "0002-new", checksum: c, staleLabel: b }],
    "0.2.0",
  );
  const [old, released] = next.split('id: "0002-new"');
  assert.equal(old, metadata.split('id: "0002-new"')[0]);
  assert.match(released!, /stage: "released",\n\s*releasedIn: "0\.2\.0",/);
  assert.match(released!, new RegExp(`checksum:\\n\\s*"${c}",`));
  assert.match(released!, new RegExp(`previousChecksums: \\["${b}"\\]`));
  assert.doesNotMatch(released!, /rerunOnChange|stage: "draft"/);
  assert.throws(
    () =>
      applyReleaseToMetadataSource(
        next,
        [{ id: "0002-new", checksum: c }],
        "0.3.0",
      ),
    /not a draft/,
  );
});

void test("releasing the repository's real draft steps yields a consistent lock and registry", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nerve-release-migrations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const migrations = join(
    "packages",
    "workbench-server",
    "src",
    "infrastructure",
    "migrations",
  );
  await cp(join(repoRoot, migrations), join(root, migrations), {
    recursive: true,
  });
  const before = JSON.parse(
    await readFile(join(root, MIGRATION_LOCK_PATH), "utf8"),
  ) as Record<string, { stage: string }>;
  const drafts = Object.keys(before).filter(
    (id) => before[id]!.stage === "draft",
  );

  const dry = await releaseDraftMigrations(root, "9.9.9", { dryRun: true });
  assert.deepEqual(dry.changedPaths, []);
  assert.deepEqual(
    dry.releases.map((r) => r.id),
    drafts,
  );

  await releaseDraftMigrations(root, "9.9.9");
  const lock = JSON.parse(
    await readFile(join(root, MIGRATION_LOCK_PATH), "utf8"),
  ) as Record<string, { stage: string; releasedIn?: string; checksum: string }>;
  const source = await readFile(join(root, MIGRATION_METADATA_PATH), "utf8");
  for (const id of drafts) {
    assert.equal(lock[id]!.stage, "released");
    assert.equal(lock[id]!.releasedIn, "9.9.9");
    assert.ok(source.includes(lock[id]!.checksum));
  }
  assert.doesNotMatch(source, /stage: "draft"/);
  assert.deepEqual((await releaseDraftMigrations(root, "9.9.10")).releases, []);
});
