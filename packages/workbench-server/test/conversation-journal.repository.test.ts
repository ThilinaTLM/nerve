import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts";
import { ConversationJournalRepository } from "../src/domains/conversations/conversation-journal.repository.js";

const conversationId = "conv_journal_test";
const now = "2026-08-23T00:00:00.000Z";

function conversation(title: string): ConversationRecord {
  return {
    id: conversationId,
    projectId: "proj_journal_test",
    title,
    mode: "coding",
    permissionLevel: "supervised",
    createdAt: now,
    updatedAt: now,
  };
}

test("conversation journal commits are chained and idempotent", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-idempotent-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const first = new ConversationJournalRepository({ paths: { home } });
  const input = {
    kind: "conversation.created",
    idempotencyKey: "create-conversation",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted" as const,
        conversationId,
        conversation: conversation("Journal test"),
      },
    ],
  };
  const committed = await first.commit(conversationId, input);
  const repeated = await new ConversationJournalRepository({
    paths: { home },
  }).commit(conversationId, input);
  assert.equal(repeated.commitId, committed.commitId);

  const replayed = await new ConversationJournalRepository({
    paths: { home },
  }).load(conversationId);
  assert.equal(replayed.revision, 1);
  assert.equal(replayed.conversation?.title, "Journal test");
  assert.match(replayed.checksum, /^sha256:[a-f0-9]{64}$/);
});

test("conversation entry appends are first-write-wins by id", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-entry-idempotent-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  const original: ConversationEntry = {
    id: "entry_task_event",
    conversationId,
    role: "system",
    kind: "task_event",
    text: "Task completed",
    createdAt: now,
  };
  await repository.commit(conversationId, {
    kind: "conversation.entry_appended",
    events: [
      { kind: "conversation.entry_appended", conversationId, entry: original },
    ],
  });
  await repository.commit(conversationId, {
    kind: "conversation.entry_appended",
    events: [
      {
        kind: "conversation.entry_appended",
        conversationId,
        entry: {
          ...original,
          parentEntryId: "entry_concurrent_parent",
          text: "Task completed with regenerated details",
        },
      },
    ],
  });

  const state = await new ConversationJournalRepository({
    paths: { home },
  }).load(conversationId);
  assert.equal(state.revision, 2);
  assert.deepEqual(state.entries, [original]);
});

test("conversation commits materialize typed records and durable events", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-record-materialize-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  await repository.commit(conversationId, {
    kind: "conversation.entry_appended",
    committedAt: now,
    events: [
      {
        kind: "conversation.entry_appended",
        conversationId,
        entry: {
          id: "entry_materialized",
          conversationId,
          role: "user",
          text: "Durable",
          createdAt: now,
        },
      },
    ],
  });
  const database = new DatabaseSync(join(home, "state.sqlite"));
  t.after(() => database.close());
  const record = database
    .prepare(
      `SELECT kind, sequence, revision FROM conversation_records WHERE id = ?`,
    )
    .get("entry_materialized") as Record<string, unknown>;
  assert.deepEqual(
    { ...record },
    {
      kind: "message",
      sequence: 1,
      revision: 1,
    },
  );
  const event = database
    .prepare(`SELECT event_type FROM durable_events WHERE conversation_id = ?`)
    .get(conversationId) as { event_type: string };
  assert.equal(event.event_type, "conversation.entry_appended");
});

test("conversation storage fails closed on malformed canonical state and bad references", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-corrupt-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  await assert.rejects(
    repository.commit(conversationId, {
      kind: "bad-identity",
      events: [
        {
          kind: "conversation.upserted",
          conversationId,
          conversation: { ...conversation("Wrong"), id: "conv_other" },
        },
      ],
    }),
    /identity mismatch/,
  );
  await repository.commit(conversationId, {
    kind: "conversation.created",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("Durable"),
      },
    ],
  });
  const database = new DatabaseSync(join(home, "state.sqlite"));
  database
    .prepare(
      `UPDATE domain_documents SET data = ?
       WHERE namespace = 'conversation_state' AND scope_id = ?`,
    )
    .run(Buffer.from("{bad-json"), conversationId);
  database.close();
  await assert.rejects(
    new ConversationJournalRepository({ paths: { home } }).load(conversationId),
    /JSON/,
  );
});
