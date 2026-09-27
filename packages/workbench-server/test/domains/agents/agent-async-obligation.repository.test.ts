import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentAsyncObligation } from "@nervekit/contracts/agents";
import type {
  ConversationEntry,
  ConversationJournalCommit,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import { JournalAgentAsyncObligationRepository } from "../../../src/domains/agents/agent-async-obligation.repository.js";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { decode } from "../../../src/infrastructure/persistence/canonical-sqlite/payload-codecs.js";

const conversationId = "conv_obligation_repository";
const ownerAgentId = "agent_root";
const createdAt = "2026-09-27T10:00:00.000Z";
const deliveredAt = "2026-09-27T10:01:00.000Z";

function conversation(): ConversationRecord {
  return {
    id: conversationId,
    projectId: "proj_test",
    title: "Obligation delivery",
    mode: "coding",
    permissionLevel: "supervised",
    activeAgentId: ownerAgentId,
    activeEntryId: "entry_root",
    createdAt,
    updatedAt: createdAt,
  };
}

function readyObligation(): AgentAsyncObligation {
  return {
    id: "promoted_task:task_repository:0",
    conversationId,
    ownerAgentId,
    sourceKind: "promoted_task",
    sourceId: "task_repository",
    state: "ready",
    notificationEntryId: "entry_task_repository_completion",
    generation: 0,
    outcome: "completed",
    createdAt,
    updatedAt: createdAt,
  };
}

test("delivery atomically advances the shared root model tree and materializes state", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-obligation-repository-"));
  const sqlitePath = join(home, "canonical.sqlite");
  const canonical = new CanonicalStore(sqlitePath, { readerCount: 0 });
  await canonical.initialize();
  const journal = new ConversationJournalRepository({
    paths: { home, sqlitePath },
    canonicalStore: canonical,
  });
  t.after(async () => {
    await journal.close();
    await canonical.close();
    await rm(home, { recursive: true, force: true });
  });

  const root: ConversationEntry = {
    id: "entry_root",
    conversationId,
    agentId: ownerAgentId,
    role: "user",
    kind: "message",
    text: "Start",
    createdAt,
  };
  await journal.commit(conversationId, {
    kind: "conversation.created",
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation(),
      },
      { kind: "conversation.entry_appended", conversationId, entry: root },
      {
        kind: "model_context.entry_appended",
        conversationId,
        entry: {
          type: "message",
          id: root.id,
          parentId: null,
          timestamp: createdAt,
          message: { role: "user", content: "Start" },
        },
      },
      {
        kind: "model_context.leaf_changed",
        conversationId,
        entryId: root.id,
      },
    ],
  });

  const repository = new JournalAgentAsyncObligationRepository(
    journal,
    canonical,
    undefined,
    () => undefined,
  );
  const obligation = readyObligation();
  await repository.register(obligation);
  const delivered = await repository.deliverWithNotice(obligation, {
    entry: {
      id: obligation.notificationEntryId,
      conversationId,
      agentId: ownerAgentId,
      role: "system",
      kind: "task_event",
      text: "Build completed.",
      createdAt: deliveredAt,
    },
    message: { role: "user", content: "Build completed." } as never,
  });

  assert.equal(delivered.state, "delivered");
  const fresh = await journal.loadFresh(conversationId);
  assert.equal(fresh.modelLeafId, obligation.notificationEntryId);
  assert.equal(fresh.agentModelEntries.has(ownerAgentId), false);
  assert.equal(
    fresh.modelEntryById.get(obligation.notificationEntryId)?.parentId,
    root.id,
  );
  assert.equal(
    fresh.entryById.get(obligation.notificationEntryId)?.parentEntryId,
    root.id,
  );
  assert.equal(
    fresh.conversation?.activeEntryId,
    obligation.notificationEntryId,
  );

  const [materializedEntries, materializedObligation] = await Promise.all([
    canonical.readConversationEntries(conversationId),
    canonical.readAgentObligation(obligation.id),
  ]);
  assert.equal(
    materializedEntries.some(
      (entry) => entry.id === obligation.notificationEntryId,
    ),
    true,
  );
  assert.equal(materializedObligation?.state, "delivered");

  const persisted = await canonical.readConversationJournal(conversationId);
  const deliveryCommit = decode(
    persisted.commits.at(-1)!,
  ) as ConversationJournalCommit;
  assert.deepEqual(
    deliveryCommit.events.map((event) => event.kind),
    [
      "conversation.entry_appended",
      "conversation.upserted",
      "model_context.entry_appended",
      "model_context.leaf_changed",
      "agent_obligation.upserted",
    ],
  );
});
