import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { z } from "zod";
import {
  appendJsonLines,
  forEachJsonLineReverse,
  readJsonFile,
  readJsonLines,
  readJsonLinesTail,
  readTextFileConsistent,
  withFileMutation,
} from "../../../src/infrastructure/storage-bootstrap/index.js";

const roots: string[] = [];
const recordSchema = z.object({ index: z.number(), text: z.string() });

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

describe("appendJsonLines", () => {
  it("appends each batch contiguously in mutation order", async () => {
    const path = await tempPath();

    const first = appendJsonLines(path, [{ value: 1 }, { value: 2 }]);
    const second = appendJsonLines(path, [{ value: 3 }, { value: 4 }]);
    await Promise.all([first, second]);

    assert.deepEqual(await readJsonLines(path, z.unknown()), [
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 4 },
    ]);
    assert.equal(
      await readFile(path, "utf8"),
      '{"value":1}\n{"value":2}\n{"value":3}\n{"value":4}\n',
    );
  });

  it("does not create a file for an empty batch", async () => {
    const path = await tempPath();

    await appendJsonLines(path, []);

    await assert.rejects(readFile(path), { code: "ENOENT" });
  });
});

describe("readTextFileConsistent", () => {
  it("waits for an in-process append before reading", async () => {
    const path = await tempPath();
    let releaseAppend!: () => void;
    const appendReleased = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    let partialWritten!: () => void;
    const partialReady = new Promise<void>((resolve) => {
      partialWritten = resolve;
    });

    const append = withFileMutation(path, async (resolvedPath) => {
      await writeFile(resolvedPath, '{"value":');
      partialWritten();
      await appendReleased;
      await appendFile(resolvedPath, "1}\n");
    });
    await partialReady;

    let readSettled = false;
    const read = readTextFileConsistent(path).finally(() => {
      readSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(readSettled, false);

    releaseAppend();
    assert.equal(await read, '{"value":1}\n');
    await append;
  });
});

describe("forEachJsonLineReverse", () => {
  it("visits records newest-first across chunks and stops early", async () => {
    const path = await tempPath();
    const records = Array.from({ length: 4_000 }, (_, index) => ({
      index,
      text: `${"x".repeat(31)}–${index}`,
    }));
    await writeFile(
      path,
      records.map((record) => JSON.stringify(record)).join("\r\n"),
    );

    const visited: number[] = [];
    await forEachJsonLineReverse(path, recordSchema, (record) => {
      visited.push(record.index);
      return visited.length < 3;
    });
    assert.deepEqual(visited, [3_999, 3_998, 3_997]);
  });

  it("skips blank and malformed lines and handles missing files", async () => {
    const path = await tempPath();
    await writeFile(path, '{"value":1}\nnot-json\n\n{"value":2}');
    const values: unknown[] = [];
    await forEachJsonLineReverse(path, z.unknown(), (value) => {
      values.push(value);
    });
    await forEachJsonLineReverse(`${path}.missing`, z.unknown(), () => {
      assert.fail("missing files must not yield values");
    });
    assert.deepEqual(values, [{ value: 2 }, { value: 1 }]);
  });
});

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

    const tail = await readJsonLinesTail(path, recordSchema, 3);
    assert.deepEqual(tail, records.slice(-3));
  });

  it("skips blank and malformed tail lines and handles missing files", async () => {
    const path = await tempPath();
    await writeFile(path, '{"value":1}\nnot-json\n\n{"value":2}');

    assert.deepEqual(await readJsonLinesTail(path, z.unknown(), 2), [
      { value: 1 },
      { value: 2 },
    ]);
    assert.deepEqual(
      await readJsonLinesTail(`${path}.missing`, z.unknown(), 2),
      [],
    );
    assert.deepEqual(await readJsonLinesTail(path, z.unknown(), 0), []);
  });
});

describe("schema validation", () => {
  it("skips JSONL lines that fail the schema", async () => {
    const path = await tempPath();
    await writeFile(path, '{"value":1}\n{"value":"x"}\n{"value":3}\n');
    const schema = z.object({ value: z.number() });
    assert.deepEqual(await readJsonLines(path, schema), [
      { value: 1 },
      { value: 3 },
    ]);
    assert.deepEqual(await readJsonLinesTail(path, schema, 5), [
      { value: 1 },
      { value: 3 },
    ]);
  });

  it("rejects a JSON file that fails the schema", async () => {
    const path = await tempPath();
    await writeFile(path, '{"value":"x"}');
    await assert.rejects(readJsonFile(path, z.object({ value: z.number() })));
  });
});
