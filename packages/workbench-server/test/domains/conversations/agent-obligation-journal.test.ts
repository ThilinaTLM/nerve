import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentAsyncObligation } from "@nervekit/contracts/agents";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";

const conversationId = "conv_obligation_test";
const createdAt = "2026-09-27T10:00:00.000Z";
const pending: AgentAsyncObligation = {
  id: "promoted_task:task_test:0",
  conversationId,
  ownerAgentId: "agent_owner",
  sourceKind: "promoted_task",
  sourceId: "task_test",
  state: "pending",
  notificationEntryId: "entry_notice",
  generation: 0,
  createdAt,
  updatedAt: createdAt,
};

test("obligation and transcript entry materialize in one journal commit", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-obligation-journal-"));
  const sqlitePath = join(home, "canonical.sqlite");
  const store = new CanonicalStore(sqlitePath, { readerCount: 0 });
  await store.initialize();
  const journal = new ConversationJournalRepository({
    paths: { home, sqlitePath },
    canonicalStore: store,
  });
  t.after(async () => {
    await journal.close();
    await store.close();
    await rm(home, { recursive: true, force: true });
  });

  await journal.commit(conversationId, {
    kind: "agent_obligation.delivered",
    events: [
      {
        kind: "conversation.entry_appended",
        conversationId,
        entry: {
          id: "entry_notice",
          conversationId,
          agentId: "agent_owner",
          role: "system",
          kind: "message",
          text: "Background task completed.",
          createdAt,
        },
      },
      {
        kind: "agent_obligation.upserted",
        conversationId,
        obligation: pending,
      },
    ],
  });

  assert.deepEqual(await store.readAgentObligation(pending.id), pending);
  assert.equal((await store.readConversationEntries(conversationId)).length, 1);
  const replayed = await journal.loadFresh(conversationId);
  assert.deepEqual(replayed.obligations.get(pending.id), pending);

  await assert.rejects(
    journal.commit(conversationId, {
      kind: "agent_obligation.invalid",
      events: [
        {
          kind: "agent_obligation.upserted",
          conversationId,
          obligation: {
            ...pending,
            state: "ready",
            sourceId: "task_changed",
            updatedAt: "2026-09-27T10:01:00.000Z",
          },
        },
      ],
    }),
    /immutable field/,
  );

  await journal.deletions.remove(conversationId);
  assert.equal(await store.readAgentObligation(pending.id), undefined);
});
