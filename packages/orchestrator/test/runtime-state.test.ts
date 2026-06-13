import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentRecord,
  ConversationEntry,
  ConversationRecord,
  ProjectRecord,
} from "@nerve/shared";
import { RuntimeState } from "../src/runtime/runtime-state.js";

const now = "2026-01-01T00:00:00.000Z";
const later = "2026-01-02T00:00:00.000Z";

function project(id: string, createdAt = now): ProjectRecord {
  return { id, name: id, dir: `/tmp/${id}`, createdAt, updatedAt: createdAt };
}

function conversation(
  id: string,
  projectId = "proj_a",
  createdAt = now,
): ConversationRecord {
  return {
    id,
    projectId,
    title: id,
    mode: "coding",
    permissionLevel: "autonomous",
    createdAt,
    updatedAt: createdAt,
  };
}

function agent(id: string, createdAt = now): AgentRecord {
  return {
    id,
    projectId: "proj_a",
    projectDir: "/tmp/proj_a",
    conversationId: "conv_a",
    rootAgentId: id,
    mode: "coding",
    permissionLevel: "autonomous",
    workspaceScope: { roots: ["/tmp/proj_a"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    thinkingLevel: "off",
    status: "idle",
    createdAt,
    updatedAt: createdAt,
  };
}

function entry(id: string, conversationId = "conv_a"): ConversationEntry {
  return {
    id,
    conversationId,
    role: "user",
    kind: "message",
    text: "hello",
    createdAt: now,
  };
}

describe("RuntimeState", () => {
  it("adds, gets, lists, and removes project records", () => {
    const state = new RuntimeState();
    const first = project("proj_a", later);
    const second = project("proj_b", now);

    state.setProject(first);
    state.setProject(second);

    assert.equal(state.getProject("proj_a"), first);
    assert.deepEqual(state.listProjects(), [second, first]);

    state.removeProject("proj_a");
    assert.throws(() => state.getProject("proj_a"), /Project not found/);
  });

  it("adds, gets, lists, removes, and rebuilds conversations", () => {
    const state = new RuntimeState();
    const first = conversation("conv_a", "proj_a", later);
    const second = conversation("conv_b", "proj_a", now);

    state.setConversation(first);
    state.setConversation(second);
    state.setConversationEntries(first.id, [entry("entry_a", first.id)]);

    assert.equal(state.getConversation("conv_a"), first);
    assert.deepEqual(state.listConversations(), [second, first]);
    assert.equal(state.getConversationEntries(first.id).length, 1);

    state.removeConversation(first.id);
    assert.throws(
      () => state.getConversation(first.id),
      /Conversation not found/,
    );
    assert.deepEqual(state.getConversationEntries(first.id), []);

    state.rebuildConversations([first]);
    assert.deepEqual(state.listConversations(), [first]);
  });

  it("adds, gets, lists, and removes agent records and run state", () => {
    const state = new RuntimeState();
    const first = agent("agent_a", later);
    const second = agent("agent_b", now);

    state.setAgent(first);
    state.setAgent(second);
    state.runs.set(first.id, {} as never);

    assert.equal(state.getAgent(first.id), first);
    assert.deepEqual(state.listAgents(), [second, first]);

    state.removeAgent(first.id);
    assert.throws(() => state.getAgent(first.id), /Agent not found/);
    assert.equal(state.runs.has(first.id), false);
  });

  it("replaces the agent conversation message cache reference", () => {
    const state = new RuntimeState();
    const cache = new Map();

    state.useAgentConversationMessages(cache);

    assert.equal(state.agentConversationMessages, cache);
  });
});
