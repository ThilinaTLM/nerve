import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { makeTempDir } from "@nervekit/test-kit";
import { z } from "zod";
import {
  atomicWriteFile,
  atomicWriteFileSync,
} from "../../../src/infrastructure/storage-bootstrap/file-mutations.js";
import { readJsonFile } from "../../../src/infrastructure/storage-bootstrap/json.js";

void test("durability levels write the same bytes and leave no temp files", async (t) => {
  const dir = await makeTempDir(t, "nerve-durability-");
  let fsyncs = 0;
  for (const durability of ["none", "file", "directory"] as const) {
    await atomicWriteFile(join(dir, durability), durability, {
      durability,
      onFsync: () => void (fsyncs += 1),
    });
    assert.equal(await readFile(join(dir, durability), "utf8"), durability);
  }
  assert.equal(fsyncs, 2, "`none` skips the file fsync");
  atomicWriteFileSync(join(dir, "sync", "nested.txt"), "sync", {
    durability: "none",
  });
  assert.equal(await readFile(join(dir, "sync", "nested.txt"), "utf8"), "sync");
  assert.deepEqual((await readdir(dir)).sort(), [
    "directory",
    "file",
    "none",
    "sync",
  ]);
});

void test("readJsonFile `missing` only covers an absent file", async (t) => {
  const dir = await makeTempDir(t, "nerve-readjson-");
  const schema = z.object({ a: z.number() });
  assert.deepEqual(
    await readJsonFile(join(dir, "none.json"), schema, {
      missing: () => ({ a: 0 }),
    }),
    { a: 0 },
  );
  await writeFile(join(dir, "bad.json"), '{"a":"x"}');
  await assert.rejects(
    readJsonFile(join(dir, "bad.json"), schema, { missing: () => ({ a: 0 }) }),
  );
  await assert.rejects(readJsonFile(join(dir, "none.json"), schema));
});
