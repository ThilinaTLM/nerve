import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentActivitySnapshot, AgentRecord } from "$lib/api";
import {
  agentAttention,
  agentDetailFields,
  agentRole,
  agentRoleLabel,
  agentRowLabel,
  agentStatusBadge,
  agentStatusLabel,
  exploreFoldSummary,
  groupAgents,
  shortTaskLabel,
} from "./context-agent-rows";

function agent(id: string, patch: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    conversationId: "conv_1",
    projectId: "proj_1",
    projectDir: "/tmp/project",
    rootAgentId: "agent_root",
    mode: "coding",
    permissionLevel: "supervised",
    workspaceScope: "project",
    budget: { depth: 0, maxDepth: 3 },
    thinkingLevel: "off",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  } as AgentRecord;
}

function activity(
  agentId: string,
  state: AgentActivitySnapshot["state"],
): AgentActivitySnapshot {
  return {
    agentId,
    conversationId: "conv_1",
    state,
    pendingInteractionCount: 0,
    pendingAsyncCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("context agent rows", () => {
  it("classifies lead, teammate, and explore roles", () => {
    assert.equal(agentRole(agent("lead")), "lead");
    assert.equal(
      agentRole(
        agent("mate", {
          parentAgentId: "lead",
          executionKind: "async_developer",
        }),
      ),
      "teammate",
    );
    assert.equal(
      agentRole(agent("explore", { parentAgentId: "lead" })),
      "explore",
    );
  });

  it("groups and ranks agents using canonical activity", () => {
    const records = [
      agent("lead"),
      agent("mate-idle", {
        parentAgentId: "lead",
        executionKind: "async_developer",
      }),
      agent("mate-running", {
        parentAgentId: "lead",
        executionKind: "async_developer",
      }),
      agent("explore-running", { parentAgentId: "lead" }),
      agent("explore-done", { parentAgentId: "lead" }),
    ];
    const activityById = {
      "mate-running": activity("mate-running", "running"),
      "explore-running": activity("explore-running", "awaiting_user"),
    };
    const groups = groupAgents(records, "lead", activityById);
    assert.deepEqual(
      groups.teammates.map(({ id }) => id),
      ["mate-running", "mate-idle"],
    );
    assert.deepEqual(
      groups.exploreLive.map(({ id }) => id),
      ["explore-running"],
    );
    assert.deepEqual(
      groups.exploreDone.map(({ id }) => id),
      ["explore-done"],
    );
    assert.deepEqual(agentAttention(records, activityById), {
      needsYou: 1,
      working: 1,
    });
  });

  it("summarizes failures from activity rather than agent records", () => {
    const done = [agent("ok"), agent("failed")];
    assert.deepEqual(
      exploreFoldSummary(done, { failed: activity("failed", "error") }),
      { finished: 1, failed: 1, label: "1 finished · 1 failed" },
    );
  });

  it("maps activity to role-aware badges including background work", () => {
    const lead = agent("lead");
    assert.deepEqual(agentStatusBadge(lead, activity("lead", "running")), {
      variant: "info",
      text: "working",
    });
    assert.deepEqual(
      agentStatusBadge(lead, activity("lead", "awaiting_async")),
      { variant: "accent", text: "background work" },
    );
    assert.equal(
      agentStatusLabel(activity("lead", "awaiting_user")),
      "awaiting user",
    );
  });

  it("derives concise labels for older explore records", () => {
    assert.equal(
      shortTaskLabel("Research async child creation, active model, and replay"),
      "Async child creation",
    );
    assert.equal(agentRowLabel(agent("lead")), "Lead agent");
    assert.equal(
      agentRowLabel(
        agent("child", {
          parentAgentId: "lead",
          task: "Investigate tool result projection",
        }),
      ),
      "Tool result projection",
    );
    assert.equal(
      agentRowLabel(
        agent("named", {
          parentAgentId: "lead",
          name: "Settings schema defaults",
          task: "Research settings schemas",
        }),
      ),
      "Settings schema defaults",
    );
    assert.equal(
      agentRowLabel(agent("blank", { parentAgentId: "lead", task: "   \n " })),
      "Explore agent",
    );
  });

  it("keeps role labels and detailed configuration", () => {
    const teammate = agent("child", {
      parentAgentId: "lead",
      executionKind: "async_developer",
      name: "server-tests",
      mode: "planning",
      permissionRuleSetId: "autonomous",
      thinkingLevel: "low",
      budget: { depth: 1, maxDepth: 3 },
      model: { provider: "openai", modelId: "gpt-5.6-luna" },
    });
    assert.equal(agentRoleLabel(teammate), "Teammate");
    const fields = agentDetailFields(teammate);
    const value = (label: string) =>
      fields.find((field) => field.label === label)?.value;
    assert.equal(value("Depth"), "1 / 3");
    assert.equal(value("Mode"), "Planning");
    assert.equal(value("Rule set"), "Planning");
    assert.equal(value("Thinking"), "low");
    assert.equal(value("Model"), "openai/gpt-5.6-luna");
    assert.ok(!fields.some((field) => field.label === "Status"));
  });
});
