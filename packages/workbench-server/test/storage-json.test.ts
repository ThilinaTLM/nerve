import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { readJsonLinesTail } from "../src/infrastructure/storage/index.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-json-tail-"));
  roots.push(root);
  return join(root, "records.jsonl");
}

describe("readJsonLinesTail", () => {
  it("reads a bounded tail in file order across chunk and UTF-8 boundaries", async () => {
    const path = await tempPath();
    const records = Array.from({ length: 4_000 }, (_, index) => ({
      index,
      text: `${"x".repeat(31)}–${index}`,
    }));
    await writeFile(
      path,
      records.map((record) => JSON.stringify(record)).join("\r\n"),
    );

    const tail = await readJsonLinesTail<(typeof records)[number]>(path, 3);
    assert.deepEqual(tail, records.slice(-3));
  });

  it("skips blank and malformed tail lines and handles missing files", async () => {
    const path = await tempPath();
    await writeFile(path, '{"value":1}\nnot-json\n\n{"value":2}');

    assert.deepEqual(await readJsonLinesTail(path, 2), [
      { value: 1 },
      { value: 2 },
    ]);
    assert.deepEqual(await readJsonLinesTail(`${path}.missing`, 2), []);
    assert.deepEqual(await readJsonLinesTail(path, 0), []);
  });
});
