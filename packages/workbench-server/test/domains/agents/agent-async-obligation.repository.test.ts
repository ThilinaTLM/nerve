import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentAsyncObligation } from "@nervekit/contracts/agents";
import type { ConversationJournalCommit } from "@nervekit/contracts/conversations";
import { JournalAgentAsyncObligationRepository } from "../../../src/domains/agents/agent-async-obligation.repository.js";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { decode } from "../../../src/infrastructure/persistence/canonical-sqlite/payload-codecs.js";

const now = "2026-09-27T10:00:00.000Z";

test("obligation registration and queue receipt transitions persist without writing context", async (t) => {
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
  const repository = new JournalAgentAsyncObligationRepository(
    journal,
    canonical,
  );
  const obligation: AgentAsyncObligation = {
    id: "promoted_task:task_repository:0",
    conversationId: "conv_obligation_repository",
    ownerAgentId: "agent_root",
    sourceKind: "promoted_task",
    sourceId: "task_repository",
    state: "ready",
    notificationEntryId: "entry_task_repository_completion",
    generation: 0,
    outcome: "completed",
    createdAt: now,
    updatedAt: now,
  };
  assert.deepEqual(await repository.register(obligation), obligation);
  assert.deepEqual(
    await repository.register({ ...obligation, outcome: "failed" }),
    obligation,
  );
  assert.deepEqual(await repository.listByStates(["ready"]), [obligation]);
  const accepted = await repository.transition(obligation.id, ["ready"], {
    queueInputId: "input_notice",
    updatedAt: "2026-09-27T10:01:00.000Z",
  });
  assert.equal(accepted.state, "ready", "queue acceptance is not delivery");
  const delivered = await repository.transition(obligation.id, ["ready"], {
    state: "delivered",
    deliveredAt: "2026-09-27T10:02:00.000Z",
    updatedAt: "2026-09-27T10:02:00.000Z",
  });
  assert.deepEqual(await repository.get(obligation.id), delivered);
  assert.deepEqual(await repository.listByStates(["ready"]), []);
  assert.deepEqual(
    await repository.transition(obligation.id, ["ready"], {
      state: "cancelled",
    }),
    delivered,
  );
  const fresh = await journal.loadFresh(obligation.conversationId);
  assert.equal(fresh.entries.length, 0);
  assert.equal(fresh.modelEntries.length, 0);
  assert.equal(fresh.agentModelEntries.size, 0);
  const persisted = await canonical.readConversationJournal(
    obligation.conversationId,
  );
  assert.equal(persisted.commits.length, 3);
  for (const payload of persisted.commits) {
    const commit = decode(payload) as ConversationJournalCommit;
    assert.deepEqual(
      commit.events.map((event) => event.kind),
      ["agent_obligation.upserted"],
    );
  }
});
