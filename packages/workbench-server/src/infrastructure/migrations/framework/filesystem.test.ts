import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  mkdir,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MigrationFilesystem } from "./filesystem.js";
import { RollbackJournal } from "./rollback-journal.js";

void test("journaled filesystem restores original bytes, renames, removals and new layout", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "migration-fs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scratch = join(root, "scratch");
  const file = join(root, "config.json");
  const removed = join(root, "removed");
  const source = join(root, "source");
  const target = join(root, "target");
  await writeFile(file, "original");
  await writeFile(removed, "retained");
  await mkdir(source);
  await writeFile(join(source, "payload"), "payload");
  const fs = new MigrationFilesystem(scratch);
  fs.write(file, "changed");
  // A restarted context must retain the first original, not an intermediate rewrite.
  new MigrationFilesystem(scratch).write(file, "changed again");
  fs.remove(removed);
  fs.rename(source, target);
  fs.mkdir(join(root, "layout"));
  fs.write(join(root, "layout", "new"), "new");
  const journal = new RollbackJournal(scratch);
  journal.restore();
  journal.restore();
  assert.equal(await readFile(file, "utf8"), "original");
  assert.equal(await readFile(removed, "utf8"), "retained");
  assert.equal(await readFile(join(source, "payload"), "utf8"), "payload");
  assert.deepEqual((await readdir(root)).sort(), [
    "config.json",
    "removed",
    "scratch",
    "source",
  ]);
});

void test("rollback handles repeated renames and journaled directory removal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "migration-renames-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scratch = join(root, "scratch");
  const fs = new MigrationFilesystem(scratch);
  const source = join(root, "source");
  const a = join(root, "a");
  const b = join(root, "b");
  await writeFile(source, "original");
  fs.rename(source, a);
  fs.rename(a, b);
  fs.write(source, "replacement");
  fs.rename(source, a);
  fs.mkdir(join(root, "new-parent", "nested"));
  const removed = join(root, "removed-directory");
  await mkdir(removed);
  await writeFile(join(removed, "payload"), "retained");
  fs.remove(removed);
  const journal = new RollbackJournal(scratch);
  assert.throws(
    () =>
      journal.restore(() => {
        throw new Error("interrupted rollback");
      }),
    /interrupted rollback/,
  );
  new RollbackJournal(scratch).restore();
  journal.restore();
  assert.equal(await readFile(source, "utf8"), "original");
  assert.equal(await readFile(join(removed, "payload"), "utf8"), "retained");
  assert.deepEqual((await readdir(root)).sort(), [
    "removed-directory",
    "scratch",
    "source",
  ]);
});
