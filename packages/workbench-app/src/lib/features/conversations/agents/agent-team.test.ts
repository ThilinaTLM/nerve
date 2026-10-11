import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentActivitySnapshot,
  AgentRecord,
} from "$lib/presentation/view-models/conversation";
import {
  agentRowState,
  agentsPillSummary,
  buildAgentTeam,
  FOLD_AFTER_MS,
  pendingWork,
} from "./agent-team";

const NOW = Date.parse("2026-01-01T01:00:00.000Z");

function agent(id: string, ageMs: number, child = true): AgentRecord {
  const at = new Date(NOW - ageMs).toISOString();
  return {
    id,
    conversationId: id,
    projectId: "p",
    projectDir: "/p",
    mode: "coding",
    createdAt: at,
    updatedAt: at,
    name: id,
    parentAgentId: child ? "lead" : undefined,
    subagentProfile: child ? "explore" : undefined,
  };
}

function activity(
  id: string,
  state: AgentActivitySnapshot["state"],
): AgentActivitySnapshot {
  return {
    agentId: id,
    conversationId: id,
    state,
    pendingInteractionCount: 0,
    pendingAsyncCount: 0,
    updatedAt: "",
  };
}

function team(
  states: Record<string, AgentActivitySnapshot["state"]>,
  ages: Record<string, number>,
  viewedId?: string,
) {
  const agents = [
    agent("lead", 0, false),
    ...Object.keys(ages).map((id) => agent(id, ages[id]!)),
  ];
  const activities = Object.fromEntries(
    Object.entries(states).map(([id, state]) => [id, activity(id, state)]),
  );
  return buildAgentTeam({
    agents,
    activities,
    leadTitle: "Lead",
    viewedId,
    nowMs: NOW,
  })!;
}

describe("agent team fold", () => {
  const old = FOLD_AFTER_MS + 1000;
  const fresh = FOLD_AFTER_MS - 1000;

  it("folds idle and stopped sub-agents after ten idle minutes", () => {
    const result = team(
      { a: "idle", b: "aborted", c: "idle" },
      { a: old, b: old, c: fresh },
    );
    assert.deepEqual(result.folded.map((r) => r.id).sort(), ["a", "b"]);
    assert.deepEqual(
      result.visible.map((r) => r.id),
      ["c"],
    );
    assert.equal(result.size, 3);
  });

  it("never folds failed, active, or viewed sub-agents", () => {
    const result = team(
      { a: "error", b: "running", c: "awaiting_async", d: "idle", e: "idle" },
      { a: old, b: old, c: old, d: old, e: old },
      "d",
    );
    assert.deepEqual(
      result.folded.map((r) => r.id),
      ["e"],
    );
    assert.equal(result.visible.length, 4);
  });

  it("orders attention first, then by recency", () => {
    const result = team(
      { a: "idle", b: "running", c: "awaiting_user", d: "idle" },
      { a: 3000, b: 9000, c: 9000, d: 1000 },
    );
    assert.deepEqual(
      result.visible.map((r) => r.id),
      ["c", "b", "d", "a"],
    );
  });
});

describe("agents pill summary", () => {
  it("is hidden without sub-agents or commands", () => {
    assert.equal(agentsPillSummary(team({}, {}), 0), undefined);
  });

  it("counts the team, working agents and commands", () => {
    const result = agentsPillSummary(
      team({ a: "running", b: "running", c: "idle" }, { a: 1, b: 1, c: 1 }),
      1,
    );
    assert.deepEqual(result, {
      size: 3,
      working: 2,
      commands: 1,
      dot: "info",
    });
  });

  it("shows only commands when there are no sub-agents", () => {
    assert.equal(agentsPillSummary(team({}, {}), 2)?.size, 0);
  });

  it("maps awaiting_async to waiting", () => {
    assert.equal(agentRowState(activity("a", "awaiting_async")), "waiting");
  });
});

describe("pending work", () => {
  it("lists unfinished sub-agents and running commands", () => {
    const items = pendingWork({
      children: [
        { id: "c1", title: "auth-research", status: "running" },
        { id: "c2", title: "done", status: "idle" },
      ],
      asyncBash: [
        { id: "b1", command: "pnpm test\nmore", status: "running" },
        { id: "b2", command: "ls", status: "completed" },
      ] as never,
    });
    assert.deepEqual(items, [
      { kind: "agent", id: "c1", label: "auth-research" },
      { kind: "command", id: "b1", label: "pnpm test" },
    ]);
  });
});
