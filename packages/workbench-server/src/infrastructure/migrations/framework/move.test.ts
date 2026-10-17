import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { MigrationFilesystem } from "./filesystem.js";
import { RollbackJournal } from "./rollback-journal.js";

void test("cross-device moves retain bytes and rollback across devices", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "migration-cross-device-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let other: string;
  try {
    other = await mkdtemp("/dev/shm/migration-cross-device-");
  } catch {
    t.skip("No writable second filesystem");
    return;
  }
  t.after(() => rm(other, { recursive: true, force: true }));
  if ((await stat(root)).dev === (await stat(other)).dev) {
    t.skip("Temporary directories share a filesystem");
    return;
  }
  const original = join(other, "original");
  const retained = join(root, "retained");
  const scratch = join(root, "scratch");
  const bytes = Buffer.from([0, 255, 1, 2, 128, 10]);
  await writeFile(original, bytes);
  new MigrationFilesystem(scratch).move(original, retained);
  await assert.rejects(readFile(original), { code: "ENOENT" });
  assert.deepEqual(await readFile(retained), bytes);
  const journal = new RollbackJournal(scratch);
  journal.restore();
  journal.restore();
  assert.deepEqual(await readFile(original), bytes);
  await assert.rejects(readFile(retained), { code: "ENOENT" });
});
