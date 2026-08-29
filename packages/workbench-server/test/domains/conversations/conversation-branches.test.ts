import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EntryRepository } from "../../../src/domains/conversations/index.js";
import {
  appendRegistryEntry,
  createdAt,
  createState,
  firstEntryId,
  oldAgentId,
  oldConversationId,
  secondEntryId,
} from "../../helpers/conversation-runtime.js";

describe("RuntimeLifecycle conversation branches", () => {
  it("imports, navigates, exports, and remaps conversation entries", async () => {
    const state = await createState("nerve-registry-import-");
    try {
      const imported = await state.services.importService.importConversation({
        project: { dir: state.storage.paths.home, name: "Imported Project" },
        conversation: {
          title: "Imported Conversation",
          mode: "coding",
          permissionLevel: "supervised",
        },
        agents: [
          {
            id: oldAgentId,
            conversationId: oldConversationId,
            projectId: "proj_01HN0000000000000000000000",
            projectDir: state.storage.paths.home,
            rootAgentId: oldAgentId,
            mode: "coding",
            permissionLevel: "supervised",
            workspaceScope: { roots: [state.storage.paths.home] },
            budget: { depth: 0, maxDepth: 3 },
            status: "idle",
            createdAt,
            updatedAt: createdAt,
          },
        ],
        entries: [
          {
            id: firstEntryId,
            conversationId: oldConversationId,
            agentId: oldAgentId,
            role: "user",
            kind: "message",
            text: "Hello",
            createdAt,
          },
          {
            id: secondEntryId,
            conversationId: oldConversationId,
            agentId: oldAgentId,
            parentEntryId: firstEntryId,
            role: "assistant",
            kind: "message",
            text: "Hi there",
            createdAt,
          },
        ],
      });

      assert.equal(imported.entries.length, 2);
      assert.notEqual(imported.conversation.id, oldConversationId);
      assert.notEqual(imported.agents[0]?.id, oldAgentId);
      assert.notEqual(imported.entries[0]?.id, firstEntryId);
      assert.equal(imported.entries[1]?.parentEntryId, imported.entries[0]?.id);
      assert.equal(
        imported.conversation.activeEntryId,
        imported.entries[1]?.id,
      );

      await state.services.navigationService.navigateConversation(
        imported.conversation.id,
        {
          activeEntryId: imported.entries[0]?.id ?? null,
        },
      );
      assert.deepEqual(
        state.lifecycle
          .getConversationEntries(imported.conversation.id)
          .map((entry) => entry.text),
        ["Hello"],
      );

      const exported = state.services.exportService.exportConversation(
        imported.conversation.id,
      );
      assert.equal(exported.entries.length, 2);
      assert.equal(exported.entries[1]?.parentEntryId, exported.entries[0]?.id);
    } finally {
      state.queryCache.close();
    }
  });

  it("projects the active branch after forking from the middle", async () => {
    const state = await createState("nerve-registry-branch-projection-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.storage.paths.home,
      });
      const conversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
          title: "Branch projection",
        });

      const first = await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "A",
      });
      const second = await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "assistant",
        text: "B",
      });
      const abandoned = await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "C",
      });

      await state.services.navigationService.navigateConversation(
        conversation.id,
        {
          activeEntryId: second.id,
        },
      );
      const forked = await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "D",
      });

      assert.deepEqual(
        state.lifecycle
          .getConversationEntries(conversation.id)
          .map((entry) => entry.text),
        ["A", "B", "D"],
      );
      assert.deepEqual(
        await state.lifecycle
          .getConversationSnapshot(conversation.id)
          .then((snapshot) => snapshot.activeEntryIds),
        [first.id, second.id, forked.id],
      );

      const tree = state.services.conversationLifecycle.getConversationTree(
        conversation.id,
      );
      assert.deepEqual(
        tree.nodes.find((node) => node.entry.id === second.id)?.childEntryIds,
        [abandoned.id, forked.id],
      );

      await state.services.navigationService.navigateConversation(
        conversation.id,
        {
          activeEntryId: null,
        },
      );
      assert.deepEqual(
        state.services.conversationLifecycle.getConversationEntries(
          conversation.id,
        ),
        [],
      );
    } finally {
      state.queryCache.close();
    }
  });

  it("repairs display parents that point at skipped harness metadata entries", () => {
    const repository = new EntryRepository({} as InitializedStorage);
    const conversation = {
      id: "conv_01HN0000000000000000000001",
      projectId: "proj_01HN0000000000000000000001",
      title: "Missing metadata parent",
      mode: "coding",
      permissionLevel: "autonomous",
      activeEntryId: "entry_01HN0000000000000000000005",
      createdAt,
      updatedAt: createdAt,
    } as const;
    const entries = [
      {
        id: "entry_01HN0000000000000000000002",
        conversationId: conversation.id,
        role: "user",
        kind: "message",
        text: "Start",
        createdAt,
      },
      {
        id: "entry_01HN0000000000000000000003",
        conversationId: conversation.id,
        parentEntryId: "entry_01HN0000000000000000000002",
        role: "system",
        kind: "message",
        text: "Plan accepted",
        createdAt,
      },
      {
        id: "entry_01HN0000000000000000000005",
        conversationId: conversation.id,
        parentEntryId: "entry_01HN0000000000000000000004",
        role: "assistant",
        kind: "message",
        text: "Continue after active tools change",
        createdAt,
      },
    ] as const;
    const entriesByConversationId = new Map([[conversation.id, [...entries]]]);

    assert.deepEqual(
      repository
        .activeBranchEntries(entriesByConversationId, conversation)
        .map((entry) => entry.text),
      ["Start", "Plan accepted", "Continue after active tools change"],
    );

    const tree = repository.getConversationTree(
      entriesByConversationId,
      conversation,
    );
    const ids = new Set(tree.nodes.map((node) => node.entry.id));
    assert.equal(
      tree.nodes.every(
        (node) =>
          !node.entry.parentEntryId || ids.has(node.entry.parentEntryId),
      ),
      true,
    );
    assert.equal(
      tree.nodes.find((node) => node.entry.id === conversation.activeEntryId)
        ?.entry.parentEntryId,
      "entry_01HN0000000000000000000003",
    );
  });
});
