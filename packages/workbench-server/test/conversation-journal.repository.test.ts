import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConversationRecord } from "@nervekit/contracts";
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

test("conversation journal truncates a non-terminated final append", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-torn-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
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
  const path = repository.journalPath(conversationId);
  await appendFile(path, '{"epoch":1,"conversationId":"conv_journal_test"');

  const replayed = await new ConversationJournalRepository({
    paths: { home },
  }).load(conversationId);
  assert.equal(replayed.revision, 1);
  assert.equal((await readFile(path, "utf8")).endsWith("\n"), true);
});

test("conversation journal fails closed on durable corruption and bad references", async (t) => {
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
  const path = repository.journalPath(conversationId);
  await writeFile(path, `${await readFile(path, "utf8")}{bad-json}\n`);
  await assert.rejects(
    new ConversationJournalRepository({ paths: { home } }).load(conversationId),
    /corrupt at line 2/,
  );
});
