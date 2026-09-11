import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "$lib/api";
import {
  agentDetailFields,
  agentRoleLabel,
  agentRowLabel,
  agentStatusLabel,
  sortAgents,
  visibleAgents,
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

describe("sortAgents", () => {
  it("puts the main agent first, then selected, live, and recent agents", () => {
    const sorted = sortAgents(
      [
        agent({
          id: "stale",
          parentAgentId: "agent_root",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        agent({
          id: "recent",
          parentAgentId: "agent_root",
          updatedAt: "2026-01-01T05:00:00.000Z",
        }),
        agent({
          id: "live",
          parentAgentId: "agent_root",
          status: "running",
          updatedAt: "2026-01-01T01:00:00.000Z",
        }),
        agent({ id: "selected", parentAgentId: "agent_root" }),
        agent({ id: "agent_root" }),
      ],
      "selected",
    );

    assert.deepEqual(ids(sorted), [
      "agent_root",
      "selected",
      "live",
      "recent",
      "stale",
    ]);
  });
});

describe("agentRowLabel", () => {
  it("names the root agent by role", () => {
    assert.equal(agentRowLabel(agent({ id: "agent_root" })), "Main agent");
  });

  it("uses the first non-empty task line for subagents", () => {
    assert.equal(
      agentRowLabel(
        agent({
          id: "child",
          parentAgentId: "agent_root",
          task: "\n  Trace tool result projection  \nmore detail",
        }),
      ),
      "Trace tool result projection",
    );
  });

  it("falls back to a role label when the task is blank", () => {
    assert.equal(
      agentRowLabel(
        agent({ id: "child", parentAgentId: "agent_root", task: "   \n " }),
      ),
      "Subagent",
    );
  });
});

describe("visibleAgents", () => {
  const many = sortAgents(
    [
      agent({ id: "agent_root" }),
      ...Array.from({ length: 10 }, (_, index) =>
        agent({
          id: `child_${index}`,
          parentAgentId: "agent_root",
          updatedAt: `2026-01-01T0${index}:00:00.000Z`,
        }),
      ),
    ],
    undefined,
  );

  it("caps the collapsed list and reports what is hidden", () => {
    const { rows, hiddenCount } = visibleAgents(many, { limit: 4 });
    assert.equal(rows.length, 4);
    assert.equal(hiddenCount, many.length - 4);
    assert.equal(rows[0]?.id, "agent_root");
  });

  it("keeps the main, live, and selected agents even past the limit", () => {
    const agents = sortAgents(
      [
        agent({ id: "agent_root" }),
        agent({ id: "live_a", parentAgentId: "agent_root", status: "running" }),
        agent({
          id: "live_b",
          parentAgentId: "agent_root",
          status: "awaiting_user",
        }),
        agent({
          id: "selected",
          parentAgentId: "agent_root",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
        agent({ id: "old", parentAgentId: "agent_root" }),
      ],
      "selected",
    );

    const { rows, hiddenCount } = visibleAgents(agents, {
      activeAgentId: "selected",
      limit: 2,
    });

    assert.deepEqual(ids(rows).sort(), [
      "agent_root",
      "live_a",
      "live_b",
      "selected",
    ]);
    assert.equal(hiddenCount, 1);
  });

  it("returns everything when expanded", () => {
    const { rows, hiddenCount } = visibleAgents(many, {
      expanded: true,
      limit: 2,
    });
    assert.equal(rows.length, many.length);
    assert.equal(hiddenCount, 0);
  });
});

describe("agent detail", () => {
  it("titles the popover by role and reads the status as words", () => {
    assert.equal(agentRoleLabel(agent({ id: "agent_root" })), "Main agent");
    assert.equal(
      agentRoleLabel(agent({ id: "child", parentAgentId: "agent_root" })),
      "Subagent",
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
