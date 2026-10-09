import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelHistoryInvalidError,
  validateModelHistoryPath,
} from "../../../src/domains/conversations/model-history-navigation.js";
import { modelEntry, navigationFixture } from "./navigation.fixture.js";

test("model paths are root-to-leaf and never use transcript parents", () => {
  const root = modelEntry("entry_root");
  const leaf = modelEntry("entry_leaf", root.id);
  assert.deepEqual(
    validateModelHistoryPath(
      new Map([
        [leaf.id, leaf],
        [root.id, root],
      ]),
      leaf.id,
    ),
    [root, leaf],
  );
  assert.deepEqual(validateModelHistoryPath(new Map(), null), []);
  assert.throws(
    () => validateModelHistoryPath(new Map([[leaf.id, leaf]]), leaf.id),
    ModelHistoryInvalidError,
  );
  const cycle = modelEntry(root.id, leaf.id);
  assert.throws(
    () =>
      validateModelHistoryPath(
        new Map([
          [leaf.id, leaf],
          [root.id, cycle],
        ]),
        leaf.id,
      ),
    ModelHistoryInvalidError,
  );
});

test("new leaf writes reject absent or foreign targets; a same-batch model append is valid", async (t) => {
  const h = await navigationFixture(t);
  const before = await h.journal.load(h.conversationId);
  const revision = before.revision;
  await assert.rejects(
    h.journal.commit(h.conversationId, {
      kind: "fixture.bad_leaf",
      events: [
        {
          kind: "model_context.leaf_changed",
          conversationId: h.conversationId,
          entryId: "entry_run_status_fixture_failed",
        },
      ],
    }),
    ModelHistoryInvalidError,
  );
  assert.equal(before.revision, revision);
  await h.journal.commit(h.conversationId, {
    kind: "fixture.batch",
    events: [
      {
        kind: "model_context.entry_appended",
        conversationId: h.conversationId,
        entry: modelEntry("entry_batch", "entry_old") as never,
      },
      {
        kind: "model_context.leaf_changed",
        conversationId: h.conversationId,
        entryId: "entry_batch",
      },
    ],
  });
  assert.equal(
    (await h.journal.loadFresh(h.conversationId)).modelLeafId,
    "entry_batch",
  );
  await assert.rejects(
    h.journal.commit(h.conversationId, {
      kind: "fixture.foreign_leaf",
      events: [
        {
          kind: "model_context.leaf_changed",
          conversationId: h.conversationId,
          ownerAgentId: "agent_other",
          entryId: "entry_batch",
        },
      ],
    }),
    ModelHistoryInvalidError,
  );
});

test("legacy detached owned compactions remain valid model boundaries in new batches", async (t) => {
  const h = await navigationFixture(t);
  await h.journal.commit(h.conversationId, {
    kind: "fixture.detached_compaction",
    events: [
      {
        kind: "model_context.entry_appended",
        conversationId: h.conversationId,
        ownerAgentId: "agent_child",
        entry: {
          type: "compaction",
          id: "entry_compacted",
          parentId: "entry_shared_unavailable",
          timestamp: h.agent.createdAt,
          summary: "complete context",
          tokensBefore: 100,
          firstKeptEntryId: "entry_shared_unavailable",
        },
      },
      {
        kind: "model_context.leaf_changed",
        conversationId: h.conversationId,
        ownerAgentId: "agent_child",
        entryId: "entry_compacted",
      },
    ],
  });
  const state = await h.journal.loadFresh(h.conversationId);
  assert.equal(
    state.agentModelEntryById.get("agent_child")!.get("entry_compacted")!
      .parentId,
    null,
  );
  assert.deepEqual(
    validateModelHistoryPath(
      state.agentModelEntryById.get("agent_child")!,
      "entry_compacted",
    ).map((entry) => entry.id),
    ["entry_compacted"],
  );
});

test("legacy dangling leaf remains diagnostic after repository reopen, never executable cached context", async (t) => {
  const h = await navigationFixture(t);
  await h.seedLegacyLeaf("entry_run_status_fixture_failed");
  const reopened = new ConversationJournalRepository({
    paths: { home: h.home },
    canonicalStore: h.canonical,
  });
  const state = await reopened.load(h.conversationId);
  assert.equal(state.modelLeafId, "entry_run_status_fixture_failed");
  assert.equal(
    state.conversation?.activeEntryId,
    "entry_run_status_fixture_failed",
  );
  assert.equal(state.modelEntryById.size, 2);
  assert.equal(state.modelTree.leafId, null);
  assert.throws(
    () => validateModelHistoryPath(state.modelEntryById, state.modelLeafId),
    ModelHistoryInvalidError,
  );
  await reopened.close();
});
