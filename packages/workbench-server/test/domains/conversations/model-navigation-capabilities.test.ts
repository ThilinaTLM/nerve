import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import {
  conversationSnapshotSchema,
  conversationTreeSchema,
  type ConversationTree,
} from "@nervekit/contracts/conversations";
import { ConversationQueryService } from "../../../src/domains/conversations/conversation-query.service.js";
import { conversationMethodHandlers } from "../../../src/adapters/protocol/handlers/conversation-method-handlers.js";
import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import type { ConversationJournalState } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { ModelNavigationCapabilities } from "../../../src/domains/conversations/model-navigation-capabilities.js";

const timestamp = "2026-10-09T00:00:00.000Z";
function model(
  id: string,
  parentId: string | null,
  role = "user",
): ConversationTreeEntry {
  return {
    id,
    parentId,
    type: "message",
    timestamp,
    message: { role, content: "fixture", timestamp: 0 },
  } as ConversationTreeEntry;
}
function fixture(leaf = "entry_assistant") {
  const entries = new Map([
    ["entry_user", model("entry_user", null)],
    ["entry_assistant", model("entry_assistant", "entry_user", "assistant")],
    ["entry_edit", model("entry_edit", "entry_assistant")],
    ["entry_tool", model("entry_tool", "entry_assistant", "toolResult")],
    ["entry_orphan", model("entry_orphan", "entry_missing")],
    ["entry_cycle", model("entry_cycle", "entry_cycle")],
  ]);
  const tree: ConversationTree = {
    conversationId: "conv_test",
    rootEntryIds: ["entry_user"],
    navigation: {
      agentId: null,
      ownerAgentId: null,
      contextState: "unavailable",
      activeModelEntryId: null,
      canNavigateToRoot: false,
    },
    nodes: [...entries.keys(), "entry_status", "entry_accepted"].map((id) => ({
      entry: {
        id,
        conversationId: "conv_test",
        parentEntryId: "entry_status",
        role: id === "entry_assistant" ? "assistant" : "user",
        kind: id === "entry_status" ? "run_status" : "message",
        text: "fixture",
        createdAt: timestamp,
      },
      childEntryIds: [],
      navigation: { continueTarget: null, editTarget: null },
    })),
  };
  const state = {
    conversationId: "conv_test",
    entries: tree.nodes.map((node) => node.entry),
    modelEntryById: entries,
    modelLeafId: leaf,
  } as unknown as ConversationJournalState;
  const agent = {
    id: "agent_test",
    conversationId: "conv_test",
    contextOwnerAgentId: null,
  } as AgentRecord;
  return {
    tree,
    state,
    agent,
    service: new ModelNavigationCapabilities({
      journal: { load: async () => state },
      resolveControlAgent: async () => agent,
    }),
  };
}

void test("owned model parent supplies edit/root targets; UI-only rows, missing ancestry and cycles have none", async () => {
  const f = fixture();
  const enriched = await f.service.enrich(f.tree);
  assert.equal(enriched.navigation.contextState, "valid");
  assert.equal(enriched.navigation.agentId, "agent_test");
  const nodes = new Map(
    enriched.nodes.map((node) => [node.entry.id, node.navigation]),
  );
  assert.deepEqual(nodes.get("entry_user")?.editTarget, {
    activeEntryId: null,
  });
  assert.deepEqual(nodes.get("entry_edit")?.editTarget, {
    activeEntryId: "entry_assistant",
  });
  assert.deepEqual(nodes.get("entry_assistant")?.continueTarget, {
    activeEntryId: "entry_assistant",
  });
  assert.equal(nodes.get("entry_assistant")?.editTarget, null);
  assert.deepEqual(nodes.get("entry_tool")?.continueTarget, {
    activeEntryId: "entry_tool",
  });
  assert.equal(nodes.get("entry_tool")?.editTarget, null);
  for (const id of [
    "entry_orphan",
    "entry_cycle",
    "entry_status",
    "entry_accepted",
  ]) {
    assert.deepEqual(nodes.get(id), { continueTarget: null, editTarget: null });
  }
});

void test("dangling current leaf does not throw away the tree or verified repair paths", async () => {
  const f = fixture("entry_status");
  const enriched = await f.service.enrich(f.tree);
  assert.equal(enriched.navigation.contextState, "invalid");
  assert.equal(enriched.navigation.problem?.code, "MODEL_HISTORY_INVALID");
  assert.equal(enriched.navigation.activeModelEntryId, "entry_status");
  assert.equal(enriched.navigation.canNavigateToRoot, true);
  assert.deepEqual(enriched.nodes[0]?.navigation.continueTarget, {
    activeEntryId: "entry_user",
  });
  assert.deepEqual(
    enriched.nodes.map((node) => node.entry),
    f.tree.nodes.map((node) => node.entry),
  );
});

void test("isolated/shared-child, foreign and ambiguous owners fail closed without leaking exceptions", async () => {
  const f = fixture();
  for (const agent of [
    { ...f.agent, contextOwnerAgentId: "agent_test" },
    { ...f.agent, contextOwnerAgentId: undefined },
    { ...f.agent, parentAgentId: "agent_parent" },
    { ...f.agent, conversationId: "conv_foreign" },
  ]) {
    const service = new ModelNavigationCapabilities({
      journal: { load: async () => f.state },
      resolveControlAgent: async () => agent,
    });
    const tree = await service.enrich(f.tree);
    assert.equal(tree.navigation.contextState, "unavailable");
    assert.equal(tree.navigation.canNavigateToRoot, false);
    assert.ok(
      tree.nodes.every(
        (node) =>
          !node.navigation.continueTarget && !node.navigation.editTarget,
      ),
    );
  }
  const unavailable = await new ModelNavigationCapabilities({
    journal: { load: async () => f.state },
    resolveControlAgent: async () => {
      throw new Error("private owner details");
    },
  }).enrich(f.tree);
  assert.doesNotMatch(JSON.stringify(unavailable.navigation), /private/);
});

void test("only genuinely empty no-agent model/transcript state exposes an explicit root no-op", async () => {
  const f = fixture();
  const service = new ModelNavigationCapabilities({
    journal: { load: async () => f.state },
    resolveControlAgent: async () => undefined,
  });
  assert.equal(
    (await service.enrich(f.tree)).navigation.canNavigateToRoot,
    false,
  );
  f.state.entries = [];
  f.state.modelEntryById.clear();
  f.state.modelLeafId = null;
  assert.equal(
    (await service.enrich({ ...f.tree, nodes: [], rootEntryIds: [] }))
      .navigation.canNavigateToRoot,
    true,
  );
});

void test("capability classification visits long shared ancestry linearly rather than validating every full path", async () => {
  const f = fixture();
  const size = 2_000;
  let reads = 0;
  class CountedEntries extends Map<string, ConversationTreeEntry> {
    override get(id: string) {
      reads++;
      return super.get(id);
    }
  }
  const entries = new CountedEntries();
  for (let i = 0; i < size; i++)
    entries.set(`entry_${i}`, model(`entry_${i}`, i ? `entry_${i - 1}` : null));
  f.state.modelEntryById = entries;
  f.state.modelLeafId = `entry_${size - 1}`;
  f.tree.nodes = [...entries.keys()].map((id) => ({
    ...f.tree.nodes[0]!,
    entry: { ...f.tree.nodes[0]!.entry, id },
  }));
  const tree = await f.service.enrich(f.tree);
  assert.ok(tree.nodes.every((node) => node.navigation.continueTarget));
  assert.ok(reads < size * 10, `expected linear owner-map reads, got ${reads}`);
});

void test("snapshot and public tree read share verified capabilities even when selected model context is invalid", async () => {
  const f = fixture("entry_status");
  const query = new ConversationQueryService({
    events: { latestSeq: async () => 9 } as never,
    state: {
      getConversation: () => ({
        id: "conv_test",
        projectId: "proj_test",
        title: "Fixture",
        mode: "coding",
        permissionLevel: "supervised",
        activeEntryId: "entry_status",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    } as never,
    getConversationRevision: async () => 3,
    getActivity: async () => ({
      conversationId: "conv_test",
      state: "idle",
      pendingInteractionCount: 0,
      pendingAsyncCount: 0,
      updatedAt: timestamp,
    }),
    getConversationEntries: async () => f.state.entries,
    getConversationTree: () => f.tree,
    enrichConversationTree: (tree) => f.service.enrich(tree),
    getContextUsage: async () => {
      throw new Error("invalid context");
    },
    listToolCallPreviews: async () => [],
    getActiveRun: async () => undefined,
  });
  const snapshot = conversationSnapshotSchema.parse(
    await query.getConversationSnapshot("conv_test"),
  );
  const response = (await conversationMethodHandlers["conversation.tree.get"]!(
    {
      conversationLifecycle: {
        ensureConversationEntries: async () => undefined,
        getConversationTree: () => {
          throw new Error("unenriched structural read");
        },
      },
      conversationQuery: query,
    } as never,
    { conversationId: "conv_test" },
    {},
  )) as { tree: ConversationTree };
  assert.deepEqual(conversationTreeSchema.parse(response.tree), snapshot.tree);
  assert.equal(snapshot.tree.navigation.contextState, "invalid");
  assert.equal(snapshot.entries.length, f.state.entries.length);
  assert.deepEqual(snapshot.tree.nodes[0]?.navigation.continueTarget, {
    activeEntryId: "entry_user",
  });
});
