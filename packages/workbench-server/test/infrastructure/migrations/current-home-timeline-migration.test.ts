import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { migrateCurrentHomeConversationTimelines } from "../../../src/infrastructure/migrations/unified-timeline/migrate-current-home-timelines.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const now = "2026-09-14T00:00:00.000Z";

test("INV-MIGRATE-02 converts a quiesced current-home journal with proof", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-current-home-migration-"));
  const sqlitePath = join(home, "nerve.sqlite");
  const store = new CanonicalStore(sqlitePath);
  await store.initialize();
  const journal = new ConversationJournalRepository({
    paths: { home, sqlitePath },
    canonicalStore: store,
  });
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  await journal.commit("conv_current", {
    kind: "migration-fixture",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId: "conv_current",
        conversation: {
          id: "conv_current",
          projectId: "proj_current",
          title: "Current",
          mode: "coding",
          permissionLevel: "supervised",
          activeEntryId: "entry_current",
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        kind: "conversation.entry_appended",
        conversationId: "conv_current",
        entry: {
          id: "entry_current",
          conversationId: "conv_current",
          role: "user",
          kind: "message",
          text: "preserve me",
          createdAt: now,
        },
      },
    ],
  });

  const proofDirectory = join(home, "migration-proofs");
  const first = await migrateCurrentHomeConversationTimelines({
    store,
    proofDirectory,
    importedAt: "2026-09-14T00:00:01.000Z",
    runtimeIsolation: "proven",
  });
  const replay = await migrateCurrentHomeConversationTimelines({
    store,
    proofDirectory,
    importedAt: "2026-09-14T00:00:01.000Z",
    runtimeIsolation: "proven",
  });
  assert.deepEqual(replay, first);
  assert.equal(first[0]?.conversationId, "conv_current");
  assert.equal(
    (await store.readTimelineConversationHead("conv_current"))?.activeEntryId,
    "entry_current",
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(proofDirectory, "conv_current.json"), "utf8"),
    ),
    first[0],
  );
  const manifest = JSON.parse(
    await readFile(join(proofDirectory, "manifest.json"), "utf8"),
  ) as { conversationCount: number; manifestDigest: string };
  assert.equal(manifest.conversationCount, 1);
  assert.match(manifest.manifestDigest, /^sha256:[a-f0-9]{64}$/);
});
