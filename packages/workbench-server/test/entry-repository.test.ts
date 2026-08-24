import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts";
import {
  buildConversationContext,
  type ConversationTreeEntry,
} from "@nervekit/harness";
import { ConversationJournalRepository } from "../src/domains/conversations/conversation-journal.repository.js";
import { EntryRepository } from "../src/domains/conversations/entry.repository.js";

const conversationId = "conv_compaction_scope";
const timestamp = "2026-08-25T00:00:00.000Z";

function conversation(activeEntryId: string): ConversationRecord {
  return {
    id: conversationId,
    projectId: "proj_compaction_scope",
    title: "Compaction scope",
    mode: "coding",
    permissionLevel: "supervised",
    activeEntryId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test("agent-attributed compaction replaces the shared model context", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-compaction-scope-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const journal = new ConversationJournalRepository({ paths: { home } });
  const repository = new EntryRepository(journal);
  const oldEntry: ConversationTreeEntry = {
    type: "message",
    id: "entry_old",
    parentId: null,
    timestamp,
    message: {
      role: "user",
      content: "Old context that must be replaced.",
      timestamp: Date.parse(timestamp),
    },
  };
  const recentEntry: ConversationTreeEntry = {
    type: "message",
    id: "entry_recent",
    parentId: oldEntry.id,
    timestamp,
    message: {
      role: "user",
      content: "Recent retained context.",
      timestamp: Date.parse(timestamp),
    },
  };
  await journal.commit(conversationId, {
    kind: "conversation.seeded",
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation(recentEntry.id),
      },
      {
        kind: "model_context.entry_appended",
        conversationId,
        entry: oldEntry as never,
      },
      {
        kind: "model_context.entry_appended",
        conversationId,
        entry: recentEntry as never,
      },
    ],
  });

  const summary = "Checkpoint summary for the continuing agent.";
  const compactionEntry: ConversationEntry = {
    id: "entry_compaction",
    conversationId,
    agentId: "agent_active",
    runId: "run_active",
    parentEntryId: recentEntry.id,
    role: "system",
    kind: "compaction",
    text: summary,
    summary,
    tokensBefore: 100_000,
    firstKeptEntryId: recentEntry.id,
    createdAt: timestamp,
  };
  const modelEntry: ConversationTreeEntry = {
    type: "compaction",
    id: compactionEntry.id,
    parentId: recentEntry.id,
    timestamp,
    summary,
    firstKeptEntryId: recentEntry.id,
    tokensBefore: 100_000,
  };

  await repository.appendCompaction({
    entry: compactionEntry,
    modelEntry,
    conversation: conversation(compactionEntry.id),
  });

  const state = await journal.load(conversationId);
  assert.equal(state.modelLeafId, compactionEntry.id);
  assert.deepEqual(
    state.modelEntries.map((entry) => entry.id),
    [oldEntry.id, recentEntry.id, compactionEntry.id],
  );
  assert.equal(state.agentModelEntries.size, 0);
  assert.equal(state.agentModelLeafIds.size, 0);
  assert.equal(state.entries.at(-1)?.agentId, "agent_active");
  assert.equal(state.entries.at(-1)?.runId, "run_active");

  const context = buildConversationContext(state.modelEntries).messages;
  assert.deepEqual(
    context.map((message) => message.role),
    ["compactionSummary", "user"],
  );
  assert.equal(
    context[0]?.role === "compactionSummary" && context[0].summary,
    summary,
  );
  assert.equal(
    context[1]?.role === "user" && context[1].content,
    "Recent retained context.",
  );
  assert.doesNotMatch(JSON.stringify(context), /Old context/);
});
