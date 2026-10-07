import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentRecordSchema } from "@nervekit/contracts/agents";
import type { InitializedStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { AgentRepository } from "../../../src/domains/agents/agent.repository.js";

const now = "2026-10-06T00:00:00.000Z";
function record() {
  return agentRecordSchema.parse({
    id: "agent_child",
    conversationId: "conv_shared",
    projectId: "proj_test",
    rootAgentId: "agent_root",
    parentAgentId: "agent_root",
    projectDir: "/workspace",
    mode: "coding",
    permissionLevel: "read_only",
    permissionRuleSetId: "read_only",
    workspaceScope: { roots: ["/workspace"], readonly: true },
    createdAt: now,
    updatedAt: now,
  });
}

test("first historical binding preserves the persisted active root rather than an older archived root", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-active-lead-"));
  const sqlitePath = join(home, "canonical.sqlite");
  let store = new CanonicalStore(sqlitePath, { readerCount: 0 });
  await store.initialize();
  const { ConversationJournalRepository } =
    await import("../../../src/domains/conversations/conversation-journal.repository.js");
  const storage = () =>
    ({
      paths: { home, sqlitePath },
      canonicalStore: store,
    }) as InitializedStorage;
  let journal = new ConversationJournalRepository(storage());
  t.after(async () => {
    await journal.close();
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const archived = {
    ...record(),
    id: "agent_old_root1",
    rootAgentId: "agent_old_root1",
    parentAgentId: undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const active = {
    ...archived,
    id: "agent_active_root2",
    rootAgentId: "agent_active_root2",
    createdAt: now,
  };
  for (const agent of [archived, active])
    await store.writeDocument({
      namespace: "agent",
      scopeId: "global",
      documentId: agent.id,
      data: agent,
      expectedRevision: 0,
      now,
    });
  const conversation = {
    id: "conv_shared",
    projectId: "proj_test",
    title: "Current lead must retain original tree",
    mode: "coding" as const,
    permissionLevel: "read_only" as const,
    activeAgentId: active.id,
    activeEntryId: "entry_active_checkpoint",
    createdAt: now,
    updatedAt: now,
  };
  const entries = [
    {
      type: "message" as const,
      id: "entry_prefix",
      parentId: null,
      timestamp: now,
      message: {
        role: "user" as const,
        content: "Shared prefix",
        timestamp: Date.parse(now),
      },
    },
    {
      type: "message" as const,
      id: "entry_active_checkpoint",
      parentId: "entry_prefix",
      timestamp: now,
      message: {
        role: "user" as const,
        content: "Active branch checkpoint",
        timestamp: Date.parse(now),
      },
    },
    {
      type: "message" as const,
      id: "entry_detached_old",
      parentId: "entry_prefix",
      timestamp: now,
      message: {
        role: "user" as const,
        content: "Detached archived path",
        timestamp: Date.parse(now),
      },
    },
  ];
  await journal.commit(conversation.id, {
    kind: "conversation.created",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: conversation.id,
        conversation,
      },
      ...entries.map((entry) => ({
        kind: "model_context.entry_appended" as const,
        conversationId: conversation.id,
        entry,
      })),
      {
        kind: "model_context.leaf_changed",
        conversationId: conversation.id,
        entryId: conversation.activeEntryId,
      },
    ],
  });
  assert.equal((await journal.load(conversation.id)).agentModelEntries.size, 0);
  const repository = new AgentRepository(storage());
  const migrated = await repository.loadAll();
  assert.equal(
    migrated.find((agent) => agent.id === active.id)?.contextOwnerAgentId,
    null,
  );
  assert.equal(
    migrated.find((agent) => agent.id === archived.id)?.contextOwnerAgentId,
    archived.id,
  );
  let state = await journal.load(conversation.id);
  assert.deepEqual(
    state.modelEntries,
    entries,
    "active legacy lead tree must remain untouched",
  );
  assert.equal(state.modelLeafId, conversation.activeEntryId);
  assert.deepEqual(state.agentModelEntries.get(archived.id), entries);
  assert.equal(
    state.agentModelLeafIds.get(archived.id),
    conversation.activeEntryId,
  );
  assert.deepEqual(state.conversation, conversation);
  await Promise.all([
    journal.commit(conversation.id, {
      kind: "active.write",
      events: [
        {
          kind: "model_context.entry_appended",
          conversationId: conversation.id,
          entry: {
            ...entries[0]!,
            id: "entry_active_future",
            parentId: conversation.activeEntryId,
          },
        },
      ],
    }),
    journal.commit(conversation.id, {
      kind: "archived.write",
      events: [
        {
          kind: "model_context.entry_appended",
          conversationId: conversation.id,
          ownerAgentId: archived.id,
          entry: {
            ...entries[0]!,
            id: "entry_archived_future",
            parentId: conversation.activeEntryId,
          },
        },
      ],
    }),
  ]);
  state = await journal.load(conversation.id);
  assert.equal(state.modelEntryById.has("entry_archived_future"), false);
  assert.equal(
    state.agentModelEntryById.get(archived.id)?.has("entry_active_future"),
    false,
  );
  assert.equal(state.modelLeafId, "entry_active_future");
  assert.equal(
    state.agentModelLeafIds.get(archived.id),
    "entry_archived_future",
  );
  await repository.remove(active.id);
  await journal.commit(conversation.id, {
    kind: "active.changed",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: conversation.id,
        conversation: { ...conversation, activeAgentId: archived.id },
      },
    ],
  });
  await journal.close();
  await store.close();
  store = new CanonicalStore(sqlitePath, { readerCount: 0 });
  await store.initialize();
  journal = new ConversationJournalRepository(storage());
  await new AgentRepository(storage()).loadAll();
  assert.equal(
    (
      await store.readDocument<{ legacyRootAgentId: string }>(
        "agent-context-binding",
        "global",
        conversation.id,
      )
    )?.data.legacyRootAgentId,
    active.id,
    "later deletion/current selection cannot change immutable first binding",
  );
  assert.equal(
    (await journal.load(conversation.id)).modelLeafId,
    "entry_active_future",
  );
});

test("missing, dangling, child and cross-conversation active identities fall back to the oldest valid historical root", async (t) => {
  for (const activeAgentId of [
    undefined,
    "agent_missing",
    "agent_child",
    "agent_other_conversation",
  ]) {
    await t.test(activeAgentId ?? "missing active selection", async (t) => {
      const home = await mkdtemp(join(tmpdir(), "nerve-402-invalid-active-"));
      const store = new CanonicalStore(join(home, "canonical.sqlite"), {
        readerCount: 0,
      });
      await store.initialize();
      t.after(async () => {
        await store.close();
        await rm(home, { recursive: true, force: true });
      });
      const older = {
        ...record(),
        id: "agent_first",
        rootAgentId: "agent_first",
        parentAgentId: undefined,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const newer = {
        ...older,
        id: "agent_second",
        rootAgentId: "agent_second",
        createdAt: now,
      };
      for (const agent of [
        newer,
        older,
        record(),
        {
          ...older,
          id: "agent_other_conversation",
          rootAgentId: "agent_other_conversation",
          conversationId: "conv_other",
        },
      ])
        await store.writeDocument({
          namespace: "agent",
          scopeId: "global",
          documentId: agent.id,
          data: agent,
          expectedRevision: 0,
          now,
        });
      await store.writeDocument({
        namespace: "conversation",
        scopeId: "global",
        documentId: "conv_shared",
        data: { activeAgentId },
        expectedRevision: 0,
        now,
      });
      const records = await new AgentRepository({
        paths: { home },
        canonicalStore: store,
      } as InitializedStorage).loadAll();
      assert.equal(
        records.find((agent) => agent.id === older.id)?.contextOwnerAgentId,
        null,
      );
      assert.equal(
        records.find((agent) => agent.id === newer.id)?.contextOwnerAgentId,
        newer.id,
      );
    });
  }
});
