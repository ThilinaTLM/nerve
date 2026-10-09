import assert from "node:assert/strict";
import test from "node:test";
import { conversationTreeSchema } from "../../src/domains/conversations/conversation-state.js";

const tree = {
  conversationId: "conv_test",
  rootEntryIds: ["entry_test"],
  navigation: {
    agentId: "agent_test",
    ownerAgentId: null,
    contextState: "invalid",
    activeModelEntryId: "entry_dangling",
    canNavigateToRoot: true,
    problem: {
      code: "MODEL_HISTORY_INVALID",
      message: "Invalid selected path",
    },
  },
  nodes: [
    {
      entry: {
        id: "entry_test",
        conversationId: "conv_test",
        role: "user",
        kind: "message",
        text: "prompt",
        createdAt: "2026-10-09T00:00:00.000Z",
      },
      childEntryIds: [],
      navigation: {
        continueTarget: { activeEntryId: "entry_test" },
        editTarget: { activeEntryId: null },
      },
    },
  ],
};

void test("navigation contract preserves unsupported targets versus explicit root and invalid-context repair targets", () => {
  assert.deepEqual(conversationTreeSchema.parse(tree), tree);
  const unsupported = {
    ...tree,
    nodes: [
      {
        ...tree.nodes[0],
        navigation: { continueTarget: null, editTarget: null },
      },
    ],
  };
  assert.deepEqual(conversationTreeSchema.parse(unsupported), unsupported);
});

void test("navigation capabilities are required, never implicitly enabled by old tree shapes", () => {
  assert.equal(
    conversationTreeSchema.safeParse({ ...tree, navigation: undefined })
      .success,
    false,
  );
  assert.equal(
    conversationTreeSchema.safeParse({
      ...tree,
      nodes: [{ ...tree.nodes[0], navigation: undefined }],
    }).success,
    false,
  );
  assert.equal(
    conversationTreeSchema.safeParse({
      ...tree,
      nodes: [
        {
          ...tree.nodes[0],
          navigation: { continueTarget: {}, editTarget: null },
        },
      ],
    }).success,
    false,
  );
});
