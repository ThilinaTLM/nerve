import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "$lib/api";
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
} from "./context-agent-rows";

function agent(overrides: Partial<AgentRecord> & { id: string }): AgentRecord {
  return {
    conversationId: "conv_1",
    projectId: "proj_1",
    projectDir: "/tmp/project",
    rootAgentId: "agent_root",
    mode: "coding",
    permissionLevel: "supervised",
    workspaceScope: "project",
    budget: { depth: 0, maxDepth: 3 },
    thinkingLevel: "off",
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentRecord;
}

function ids(agents: readonly AgentRecord[]): string[] {
  return agents.map((entry) => entry.id);
}

describe("agentRole", () => {
  it("classifies lead, teammates, and explore agents including older records", () => {
    assert.equal(agentRole(agent({ id: "agent_root" })), "lead");
    assert.equal(
      agentRole(
        agent({
          id: "mate",
          parentAgentId: "agent_root",
          executionKind: "async_developer",
        }),
      ),
      "teammate",
    );
    assert.equal(
      agentRole(
        agent({
          id: "new",
          parentAgentId: "agent_root",
          executionKind: "explore",
        }),
      ),
      "explore",
    );
    assert.equal(
      agentRole(agent({ id: "legacy", parentAgentId: "agent_root" })),
      "explore",
    );
  });
});

describe("groupAgents", () => {
  const child = (overrides: Partial<AgentRecord> & { id: string }) =>
    agent({ parentAgentId: "agent_root", ...overrides });

  it("splits roles and orders teammates by attention then recency", () => {
    const groups = groupAgents([
      child({ id: "explore_done", updatedAt: "2026-01-01T09:00:00.000Z" }),
      child({
        id: "mate_idle",
        executionKind: "async_developer",
        updatedAt: "2026-01-01T09:00:00.000Z",
      }),
      child({
        id: "mate_running",
        executionKind: "async_developer",
        status: "running",
      }),
      child({
        id: "mate_waiting",
        executionKind: "async_developer",
        status: "awaiting_user",
      }),
      child({ id: "explore_running", status: "running" }),
      agent({ id: "agent_root" }),
    ]);

    assert.equal(groups.lead?.id, "agent_root");
    assert.deepEqual(ids(groups.teammates), [
      "mate_waiting",
      "mate_running",
      "mate_idle",
    ]);
    assert.deepEqual(ids(groups.exploreLive), ["explore_running"]);
    assert.deepEqual(ids(groups.exploreDone), ["explore_done"]);
  });

  it("folds settled explore agents newest first and keeps live ones visible", () => {
    const groups = groupAgents([
      child({ id: "old", updatedAt: "2026-01-01T01:00:00.000Z" }),
      child({
        id: "failed",
        status: "error",
        updatedAt: "2026-01-01T03:00:00.000Z",
      }),
      child({
        id: "cancelled",
        status: "aborted",
        updatedAt: "2026-01-01T02:00:00.000Z",
      }),
      child({ id: "waiting", status: "awaiting_user" }),
    ]);

    assert.deepEqual(ids(groups.exploreLive), ["waiting"]);
    assert.deepEqual(ids(groups.exploreDone), ["failed", "cancelled", "old"]);
  });
});

describe("agent attention and explore fold", () => {
  it("counts agents that need the user or are working", () => {
    assert.deepEqual(
      agentAttention([
        agent({ id: "a", status: "running" }),
        agent({ id: "b", status: "running" }),
        agent({ id: "c", status: "awaiting_user" }),
        agent({ id: "d" }),
      ]),
      { needsYou: 1, working: 2 },
    );
  });

  it("summarizes finished and failed explore agents", () => {
    assert.equal(
      exploreFoldSummary([agent({ id: "a" }), agent({ id: "b" })]).label,
      "2 finished",
    );
    assert.deepEqual(
      exploreFoldSummary([
        agent({ id: "a" }),
        agent({ id: "b", status: "error" }),
        agent({ id: "c", status: "aborted" }),
      ]),
      { finished: 1, failed: 2, label: "1 finished · 2 failed" },
    );
  });

  it("maps statuses to row badges by role", () => {
    const explore = agent({
      id: "e",
      parentAgentId: "agent_root",
      status: "running",
    });
    assert.deepEqual(agentStatusBadge(explore), {
      variant: "info",
      text: "running",
    });
    assert.deepEqual(
      agentStatusBadge(agent({ id: "agent_root", status: "running" })),
      {
        variant: "info",
        text: "working",
      },
    );
    assert.deepEqual(
      agentStatusBadge(agent({ id: "agent_root", status: "awaiting_user" })),
      { variant: "warning", text: "needs you" },
    );
    assert.deepEqual(agentStatusBadge({ ...explore, status: "error" }), {
      variant: "destructive",
      text: "failed",
    });
    assert.equal(agentStatusBadge({ ...explore, status: "idle" }), undefined);
  });
});

describe("agentRowLabel", () => {
  it("names the root agent by role", () => {
    assert.equal(agentRowLabel(agent({ id: "agent_root" })), "Lead agent");
  });

  it("prefers the persisted explore label", () => {
    assert.equal(
      agentRowLabel(
        agent({
          id: "child",
          parentAgentId: "agent_root",
          executionKind: "explore",
          name: "Settings schema defaults",
          task: "Research settings schemas, defaults, and patches in depth",
        }),
      ),
      "Settings schema defaults",
    );
  });

  it("shortens older explore prompts into a name", () => {
    const label = (task: string) =>
      agentRowLabel(agent({ id: "child", parentAgentId: "agent_root", task }));
    assert.equal(
      label(
        "Research async child creation, active agent model, and transport replay for children",
      ),
      "Async child creation",
    );
    assert.equal(
      label("Investigate: how explore.tools.ts validates labels. Then report."),
      "How explore.tools.ts validates labels",
    );
    assert.equal(
      label(
        "look into the settings page configure dialog patterns used across tool settings",
      ),
      "The settings page configure dialog patterns…",
    );
  });

  it("uses the first non-empty task line for older explore prompts", () => {
    assert.equal(
      agentRowLabel(
        agent({
          id: "child",
          parentAgentId: "agent_root",
          task: "\n  Trace tool result projection  \nmore detail",
        }),
      ),
      "Tool result projection",
    );
  });

  it("labels async teammates by name and role", () => {
    const teammate = agent({
      id: "child",
      parentAgentId: "agent_root",
      executionKind: "async_developer",
      name: "server-tests",
    });
    assert.equal(agentRowLabel(teammate), "server-tests");
    assert.equal(agentRoleLabel(teammate), "Teammate");
  });

  it("falls back to a role label when the task is blank", () => {
    assert.equal(
      agentRowLabel(
        agent({ id: "child", parentAgentId: "agent_root", task: "   \n " }),
      ),
      "Explore agent",
    );
  });
});

describe("agent detail", () => {
  it("titles the popover by role and reads the status as words", () => {
    assert.equal(agentRoleLabel(agent({ id: "agent_root" })), "Lead agent");
    assert.equal(
      agentRoleLabel(agent({ id: "child", parentAgentId: "agent_root" })),
      "Explore agent",
    );
    assert.equal(
      agentStatusLabel(agent({ id: "child", status: "awaiting_user" })),
      "awaiting user",
    );
  });

  it("carries the configuration dropped from the row", () => {
    const fields = agentDetailFields(
      agent({
        id: "agent_child",
        parentAgentId: "agent_root",
        mode: "planning",
        permissionRuleSetId: "autonomous",
        thinkingLevel: "low",
        budget: { depth: 1, maxDepth: 3 },
        model: { provider: "openai", modelId: "gpt-5.6-luna" },
        status: "awaiting_user",
      }),
    );
    const value = (label: string) =>
      fields.find((field) => field.label === label)?.value;

    assert.equal(value("Depth"), "1 / 3");
    assert.equal(value("Mode"), "Planning");
    assert.equal(value("Rule set"), "Planning");
    assert.equal(value("Thinking"), "low");
    assert.equal(value("Model"), "openai/gpt-5.6-luna");
    assert.equal(
      fields.find((field) => field.label === "Agent")?.title,
      "agent_child",
    );
    assert.ok(
      !fields.some((field) => field.label === "Status"),
      "status belongs to the header badge, not the property list",
    );
  });
});
