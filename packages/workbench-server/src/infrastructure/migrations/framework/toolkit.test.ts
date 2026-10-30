import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";
import { createStepContext } from "./context.js";
import { storagePaths } from "../../storage-bootstrap/paths.js";
import { DiscardableMigrationError } from "./step.js";
import {
  finishPhase,
  startPhase,
  toolkitState,
  writeUpgradeReport,
} from "./toolkit.js";

async function fixture(t: TestContext) {
  const home = await mkdtemp(join(tmpdir(), "migration-toolkit-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return createStepContext(
    storagePaths(home),
    "0001-example",
    "Example",
    () => {},
  ).context;
}
void test("units aggregate failures and isolate transaction, files, and loss checkpoints", async (t) => {
  const ctx = await fixture(t);
  const file = join(ctx.paths.home, "owned");
  await writeFile(file, "before");
  let value = 1;
  let transactions = 0;
  startPhase(ctx, "run");
  await ctx.unit(
    { kind: "conversation", id: "bad-one" },
    async () => {
      ctx.fs.write(file, "failed");
      ctx.loss("should disappear");
      value = 2;
      throw new Error("first failure");
    },
    {
      transaction: async (action) => {
        transactions++;
        const saved = value;
        try {
          return await action();
        } catch (error) {
          value = saved;
          throw error;
        }
      },
    },
  );
  await ctx.unit({ kind: "conversation", id: "good" }, () => {
    ctx.fs.write(file, "good");
    ctx.loss("expected loss", 2);
  });
  await ctx.unit({ kind: "conversation", id: "bad-two" }, () => {
    ctx.fs.write(file, "failed again");
    throw new Error("second failure");
  });
  assert.equal(value, 1);
  assert.equal(transactions, 1);
  assert.equal(await readFile(file, "utf8"), "good");
  assert.deepEqual(toolkitState(ctx).losses, [
    { reason: "expected loss", count: 2 },
  ]);
  assert.throws(
    () => finishPhase(ctx),
    (error: unknown) =>
      error instanceof DiscardableMigrationError &&
      error.items.map((item) => item.id).join() === "bad-one,bad-two",
  );
});
void test("checked JSON rejects unowned paths, aggregates schema failures and enforces read-only check", async (t) => {
  const ctx = await fixture(t);
  const file = join(ctx.paths.home, "owned.json");
  await writeFile(file, "{}");
  const schema = {
    parse(value: unknown) {
      assert.equal((value as { version: number }).version, 1);
      return value;
    },
  };
  startPhase(ctx, "check");
  assert.throws(() => ctx.readJson(file, schema), /does not own/);
  ctx.ownPaths([file]);
  await ctx.unit({ kind: "configuration", id: file }, () =>
    ctx.readJson(file, schema),
  );
  await ctx.unit({ kind: "conversation", id: "attempted-write" }, () =>
    ctx.fs.write(file, "changed"),
  );
  assert.equal(await readFile(file, "utf8"), "{}");
  assert.throws(
    () => finishPhase(ctx),
    (error: unknown) =>
      error instanceof DiscardableMigrationError && error.items.length === 2,
  );
});
void test("discarded units quarantine raw files and persist a private report independently of scratch", async (t) => {
  const ctx = await fixture(t);
  const file = join(ctx.paths.home, "broken.json");
  await writeFile(file, "{broken");
  (ctx.discarded as Set<string>).add(file);
  startPhase(ctx, "run");
  await ctx.unit(
    { kind: "configuration", id: file },
    () => assert.fail("discarded unit ran"),
    { quarantine: { files: [file] } },
  );
  await writeUpgradeReport(ctx, "0001-example", "Example");
  const reportPath = join(
    ctx.paths.home,
    "migrations/reports/0001-example.json",
  );
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (process.platform !== "win32")
    assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
  await rm(ctx.scratchDir, { recursive: true, force: true });
  assert.equal(
    await readFile(
      join(report.setAside[0].quarantinePath, "payload/broken.json"),
      "utf8",
    ),
    "{broken",
  );
  assert.equal(
    JSON.parse(await readFile(reportPath, "utf8")).step,
    "0001-example",
  );
});
void test("an interrupted unit journal restores its entry state before a retry", async (t) => {
  const ctx = await fixture(t);
  const file = join(ctx.paths.home, "file");
  await writeFile(file, "original");
  ctx.fs.beginUnit();
  ctx.fs.write(file, "interrupted");
  const restarted = createStepContext(
    ctx.paths,
    "0001-example",
    "Example",
    () => {},
  ).context;
  restarted.fs.recoverUnit();
  assert.equal(await readFile(file, "utf8"), "original");
});

void test("quarantine streams lossless BLOB rows, retains unicode and deduplicates retry exports", async (t) => {
  const ctx = await fixture(t);
  startPhase(ctx, "run");
  const bytes = new Uint8Array([0, 128, 255, 10, 13]);
  const first = {
    table: "records",
    row: { id: "first", data: bytes, text: "🙂".repeat(30_000) },
  };
  const item = {
    kind: "configuration" as const,
    id: "legacy-record:example/first",
    reason: "Unreadable source row",
  };
  const path = ctx.quarantine(item, { records: [first] });
  ctx.quarantine(item, {
    records: (function* () {
      yield first;
      yield { table: "records", row: { id: "second" } };
    })(),
  });
  const lines = (await readFile(join(path, "payload/records.jsonl"), "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].row.text, first.row.text);
  assert.deepEqual(
    Buffer.from(lines[0].row.data.$blob, "base64"),
    Buffer.from(bytes),
  );
  assert.equal(lines[1].row.id, "second");
});

void test("quarantine moves an owned symlink boundary instead of touching its external target", async (t) => {
  const ctx = await fixture(t);
  const project = await mkdtemp(join(tmpdir(), "migration-project-"));
  const external = await mkdtemp(join(tmpdir(), "migration-unowned-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await mkdir(join(project, ".nerve"));
  await writeFile(join(external, "file.json"), "untouched");
  const boundary = join(project, ".nerve", "config");
  try {
    await symlink(external, boundary, "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Symlink privilege unavailable");
      return;
    }
    throw error;
  }
  const file = join(boundary, "file.json");
  const path = ctx.quarantine(
    { kind: "configuration", id: file, reason: "Symbolic link traversal" },
    { files: [file], root: project },
  );
  assert.equal(
    await readFile(join(external, "file.json"), "utf8"),
    "untouched",
  );
  assert.equal(await readlink(join(path, "payload", "config")), external);
  assert.equal(
    JSON.parse(await readFile(join(path, "reason.json"), "utf8")).originalPath,
    boundary,
  );
});

void test("retained runtime settings preserve bytes and symlinks without following them", async (t) => {
  const ctx = await fixture(t);
  const settings = join(ctx.paths.home, "settings");
  await mkdir(settings);
  await writeFile(join(settings, "broken.json"), "broken bytes");
  await symlink("/does-not-exist/outside-home", join(settings, "linked.json"));
  startPhase(ctx, "run");
  const path = ctx.quarantine(
    { kind: "configuration", id: settings, reason: "Invalid settings" },
    { files: [settings], retainSource: true },
  );
  assert.equal(
    await readFile(join(settings, "broken.json"), "utf8"),
    "broken bytes",
  );
  assert.equal(
    await readFile(join(path, "payload/settings/broken.json"), "utf8"),
    "broken bytes",
  );
  assert.equal(
    await readlink(join(settings, "linked.json")),
    "/does-not-exist/outside-home",
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(path, "payload/settings/linked.json.symlink.json"),
        "utf8",
      ),
    ),
    { target: "/does-not-exist/outside-home" },
  );
});
