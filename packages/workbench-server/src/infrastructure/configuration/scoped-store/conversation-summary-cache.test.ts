import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { atomicWriteFile } from "../../storage-bootstrap/file-mutations.js";
import {
  ConversationSummaryCache,
  type SummaryDocument,
} from "./conversation-summary-cache.js";

interface Summary {
  observedDigest: string;
  model?: string;
}
function parse(input: unknown): SummaryDocument<Summary> {
  const document = input as SummaryDocument<Summary>;
  if (document.schemaVersion !== 1 || !document.entries)
    throw new Error("Invalid cache");
  for (const entry of Object.values(document.entries)) {
    if (typeof entry.observedDigest !== "string")
      throw new Error("Invalid entry");
  }
  return document;
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "summary-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "summaries.json");
  return {
    file,
    make: () => new ConversationSummaryCache({ path: file, parse }),
  };
}

void test("cache loss, corruption and future versions are empty, never fabricated defaults", async (t) => {
  const f = await fixture(t);
  for (const bytes of [
    undefined,
    "{",
    '{"schemaVersion":2,"entries":{}}',
    '{"schemaVersion":1,"entries":{"one":{}}}',
  ]) {
    if (bytes !== undefined) await writeFile(f.file, bytes);
    const cache = f.make();
    await cache.load();
    assert.equal(cache.get("one"), undefined);
  }
});

void test("cache coalesces atomic writes, survives reload and removes deleted entries", async (t) => {
  const f = await fixture(t);
  let writes = 0;
  const cache = new ConversationSummaryCache({
    path: f.file,
    parse,
    write: async (...args) => {
      writes += 1;
      await atomicWriteFile(...args);
    },
  });
  const summary = { observedDigest: "abc", model: "display only" };
  cache.set("one", summary);
  summary.model = "mutated";
  const first = cache.flush();
  cache.set("two", { observedDigest: "def" });
  assert.equal(cache.flush(), first);
  assert.equal(await first, true);
  assert.equal(writes, 1);
  assert.equal(cache.get("one")?.model, "display only");
  assert.ok(Object.isFrozen(cache.get("one")));
  const reloaded = f.make();
  await reloaded.load();
  assert.equal(reloaded.get("two")?.observedDigest, "def");
  reloaded.remove("one");
  await reloaded.flush();
  assert.equal(
    JSON.parse(await readFile(f.file, "utf8")).entries.one,
    undefined,
  );
  await rm(f.file);
  const lost = f.make();
  await lost.load();
  assert.equal(lost.get("two"), undefined);
});

void test("cache write failure is recoverable and never throws into the save path", async (t) => {
  const f = await fixture(t);
  let fail = true;
  const cache = new ConversationSummaryCache({
    path: f.file,
    parse,
    write: async (...args) => {
      if (fail) throw new Error("disk full");
      await atomicWriteFile(...args);
    },
  });
  cache.set("one", { observedDigest: "abc" });
  assert.equal(await cache.flush(), false);
  assert.equal(cache.get("one")?.observedDigest, "abc");
  fail = false;
  assert.equal(await cache.flush(), true);
});

void test("changes during a cache write are flushed in the next batch", async (t) => {
  const f = await fixture(t);
  let writes = 0;
  const cache = new ConversationSummaryCache<Summary>({
    path: f.file,
    parse,
    write: async (...args) => {
      writes += 1;
      if (writes === 1) cache.set("two", { observedDigest: "def" });
      await atomicWriteFile(...args);
    },
  });
  cache.set("one", { observedDigest: "abc" });
  assert.equal(await cache.flush(), true);
  assert.equal(writes, 2);
  assert.ok(JSON.parse(await readFile(f.file, "utf8")).entries.two);
});

void test("load does not resurrect a deletion made before initial cache loading", async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.file,
    JSON.stringify({
      schemaVersion: 1,
      entries: { one: { observedDigest: "old" } },
    }),
  );
  const cache = f.make();
  cache.remove("one");
  await cache.load();
  assert.equal(cache.get("one"), undefined);
});
