import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import { LegacyConversationTimelineImporter } from "../../../src/infrastructure/migrations/unified-timeline/import-legacy-conversation.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const digest = `sha256:${"a".repeat(64)}`;

async function fixture(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), "nerve-unified-import-"));
  const sqlitePath = join(home, "nerve.sqlite");
  const store = new CanonicalStore(sqlitePath);
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  return { store, sqlitePath };
}

function entry(index: number, parentEntryId?: string): ConversationEntry {
  return {
    id: `entry_legacy_${index}`,
    conversationId: "conv_legacy",
    ...(parentEntryId ? { parentEntryId } : {}),
    role: index % 2 === 0 ? "user" : "assistant",
    kind: "message",
    text: `message ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  };
}

test("INV-MIGRATION-01 imports a branching legacy history in restart-safe bounded batches", async (t) => {
  const { store, sqlitePath } = await fixture(t);
  const entries: ConversationEntry[] = [entry(0)];
  for (let index = 1; index < 66; index += 1) {
    entries.push(entry(index, `entry_legacy_${index - 1}`));
  }
  entries.push(entry(100, "entry_legacy_0"));
  const source = {
    conversationId: "conv_legacy",
    entries,
    activeEntryId: "entry_legacy_100",
    sourceLocator: "conversations/conv_legacy/journal.jsonl",
    sourceDigest: digest,
    importedAt: "2026-01-02T00:00:00.000Z",
  };
  const importer = new LegacyConversationTimelineImporter(store);
  const first = await importer.import(source);
  assert.equal(first.head.revision, 2);
  assert.equal(first.head.activeEntryId, "entry_legacy_100");
  assert.equal(first.proof.sourceEntryCount, 67);
  assert.equal(first.proof.importedEntryCount, 67);
  assert.equal(first.proof.rootCount, 1);
  assert.equal(first.proof.batchCount, 2);
  assert.match(first.proof.proofDigest, /^sha256:[a-f0-9]{64}$/);

  const replay = await importer.import(source);
  assert.deepEqual(replay, first);
  const database = new DatabaseSync(sqlitePath, { readOnly: true });
  const counts = database
    .prepare(
      `SELECT COUNT(*) AS entries, COUNT(DISTINCT transition_id) AS transitions
       FROM conversation_entries WHERE conversation_id = ?`,
    )
    .get("conv_legacy") as { entries: number; transitions: number };
  const branch = database
    .prepare(
      `SELECT parent_entry_id FROM conversation_entries WHERE entry_id = ?`,
    )
    .get("entry_legacy_100") as { parent_entry_id: string };
  database.close();
  assert.equal(counts.entries, 67);
  assert.equal(counts.transitions, 2);
  assert.equal(branch.parent_entry_id, "entry_legacy_0");
});

test("INV-MIGRATION-01 rejects missing parents and cycles before mutation", async (t) => {
  const { store } = await fixture(t);
  const importer = new LegacyConversationTimelineImporter(store);
  const base = {
    conversationId: "conv_legacy",
    activeEntryId: "entry_legacy_0",
    sourceLocator: "conversations/conv_legacy/journal.jsonl",
    sourceDigest: digest,
    importedAt: "2026-01-02T00:00:00.000Z",
  };
  await assert.rejects(
    importer.import({ ...base, entries: [entry(0, "entry_missing")] }),
    /missing parent/,
  );
  await assert.rejects(
    importer.import({
      ...base,
      entries: [entry(0, "entry_legacy_1"), entry(1, "entry_legacy_0")],
    }),
    /contains a cycle/,
  );
  assert.equal(
    await store.readTimelineConversationHead("conv_legacy"),
    undefined,
  );
});
