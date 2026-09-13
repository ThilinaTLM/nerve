import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migratePost0012ConversationTimelines } from "../../../src/infrastructure/migrations/unified-timeline/migrate-post0012-timelines.js";
import { readPost0012ConversationTimeline } from "../../../src/infrastructure/migrations/unified-timeline/read-post0012-conversation.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

async function fixture(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), "nerve-post0012-reader-"));
  const directory = join(home, "conversations", "conv_source");
  await mkdir(directory, { recursive: true });
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(
    join(directory, "conversation.json"),
    JSON.stringify({
      id: "conv_source",
      projectId: "proj_source",
      title: "Imported",
      state: "active",
      mode: "coding",
      permissionLevel: "supervised",
      activeEntryId: "entry_source",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  await writeFile(
    join(directory, "entries.jsonl"),
    `${JSON.stringify({
      id: "entry_source",
      conversationId: "conv_source",
      role: "user",
      kind: "message",
      text: "hello",
      createdAt: "2026-01-01T00:00:00.000Z",
    })}\n`,
  );
  return { home, directory };
}

test("reads a strict digest-bound post-0012 timeline source", async (t) => {
  const { home } = await fixture(t);
  const source = await readPost0012ConversationTimeline({
    sourceHome: home,
    conversationId: "conv_source",
    importedAt: "2026-01-02T00:00:00.000Z",
  });
  assert.equal(source.activeEntryId, "entry_source");
  assert.equal(source.entries.length, 1);
  assert.match(source.sourceDigest, /^sha256:[a-f0-9]{64}$/);
});

test("converts source timelines and publishes proof reports", async (t) => {
  const { home } = await fixture(t);
  const target = await mkdtemp(join(tmpdir(), "nerve-post0012-target-"));
  const store = new CanonicalStore(join(target, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(target, { recursive: true, force: true });
  });
  const proofDirectory = join(target, "proofs");
  const proofs = await migratePost0012ConversationTimelines({
    sourceHome: home,
    targetStore: store,
    proofDirectory,
    importedAt: "2026-01-02T00:00:00.000Z",
  });
  assert.equal(proofs.length, 1);
  assert.equal(
    (await store.readTimelineConversationHead("conv_source"))?.activeEntryId,
    "entry_source",
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(proofDirectory, "conv_source.json"), "utf8"),
    ),
    proofs[0],
  );
});

test("rejects malformed post-0012 entries instead of silently dropping them", async (t) => {
  const { home, directory } = await fixture(t);
  await writeFile(join(directory, "entries.jsonl"), "not-json\n");
  await assert.rejects(
    readPost0012ConversationTimeline({
      sourceHome: home,
      conversationId: "conv_source",
      importedAt: "2026-01-02T00:00:00.000Z",
    }),
    /entry line 1 is invalid/,
  );
});
