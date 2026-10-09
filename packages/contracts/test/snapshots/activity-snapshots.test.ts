import assert from "node:assert/strict";
import test from "node:test";
import { conversationSnapshotSchema } from "../../src/domains/conversations/live-state.js";
import { workspaceSnapshotSchema } from "../../src/snapshots/runtime-snapshot.js";

const now = "2026-09-27T10:00:00.000Z";
const conversationActivity = {
  conversationId: "conv_1",
  activeAgentId: "agent_1",
  state: "running" as const,
  pendingInteractionCount: 0,
  pendingAsyncCount: 1,
  updatedAt: now,
};

test("workspace snapshots require complete activity projections", () => {
  const snapshot = {
    projects: [],
    conversations: [],
    agents: [],
    agentActivities: [
      {
        agentId: "agent_1",
        conversationId: "conv_1",
        state: "awaiting_async" as const,
        pendingInteractionCount: 0,
        pendingAsyncCount: 1,
        updatedAt: now,
      },
    ],
    conversationActivities: [conversationActivity],
    tasks: [],
    pendingToolCalls: [],
  };

  assert.deepEqual(workspaceSnapshotSchema.parse(snapshot), snapshot);
  assert.equal(
    workspaceSnapshotSchema.safeParse({
      ...snapshot,
      agentActivities: undefined,
    }).success,
    false,
  );
  assert.equal(
    workspaceSnapshotSchema.safeParse({
      ...snapshot,
      conversationActivities: undefined,
    }).success,
    false,
  );
});

test("conversation snapshots require their conversation activity", () => {
  const snapshot = {
    conversation: {
      id: "conv_1",
      projectId: "proj_1",
      title: "Activity",
      mode: "coding" as const,
      permissionLevel: "supervised" as const,
      activeAgentId: "agent_1",
      createdAt: now,
      updatedAt: now,
    },
    activity: conversationActivity,
    conversationRevision: 1,
    entries: [],
    activeEntryIds: [],
    tree: {
      conversationId: "conv_1",
      rootEntryIds: [],
      navigation: {
        agentId: null,
        ownerAgentId: null,
        contextState: "unavailable",
        activeModelEntryId: null,
        canNavigateToRoot: false,
      },
      nodes: [],
    },
    toolCalls: [],
    cursorSeq: 0,
    generatedAt: now,
  };

  assert.deepEqual(conversationSnapshotSchema.parse(snapshot), snapshot);
  assert.equal(
    conversationSnapshotSchema.safeParse({ ...snapshot, activity: undefined })
      .success,
    false,
  );
});
