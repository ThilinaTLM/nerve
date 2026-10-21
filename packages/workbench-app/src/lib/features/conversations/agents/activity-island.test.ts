import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AsyncBash } from "@nervekit/contracts/core";
import type {
  AgentActivitySnapshot,
  AgentRecord,
} from "$lib/presentation/view-models/conversation";
import {
  commandFirstLine,
  COMMAND_STATE_LABEL,
  islandAgents,
  islandCommands,
  islandCount,
} from "./activity-island";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const at = (secondsAgo: number) =>
  new Date(NOW - secondsAgo * 1000).toISOString();
function agent(id: string, age = 0): AgentRecord {
  return {
    id,
    conversationId: id,
    projectId: "p",
    projectDir: "/p",
    createdAt: at(age + 100),
    updatedAt: at(age),
    lastParentPromptAt: at(age),
    parentAgentId: "lead",
    name: ` ${id} `,
    task: `Full prompt for ${id}\nSecond line`,
    agentProfile: "explore",
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
    pendingAsyncCount: 0,
    pendingInteractionCount: 0,
    updatedAt: at(0),
  };
}
function command(
  id: string,
  status: AsyncBash["status"],
  secondsAgo = 0,
): AsyncBash {
  return {
    id,
    conversationId: "lead",
    toolCallId: id,
    command: `echo ${id}\nsecond line`,
    workingDirectory: "/p",
    status,
    processRef: null,
    exitCode: null,
    startedAt: at(secondsAgo + 60),
    finishedAt: status === "running" ? null : at(secondsAgo),
  };
}

describe("activity island retention and ordering", () => {
  it("retains every child, including old completed/stopped agents, but excludes the lead", () => {
    const lead = { ...agent("lead"), parentAgentId: undefined };
    const children = [
      agent("old", 100_000),
      agent("stop", 90_000),
      agent("working"),
      agent("wait"),
      agent("error"),
      agent("attention"),
      agent("unknown"),
    ];
    const states: AgentActivitySnapshot["state"][] = [
      "idle",
      "aborted",
      "running",
      "awaiting_async",
      "error",
      "awaiting_user",
    ];
    const activities = Object.fromEntries(
      children.slice(0, 6).map((a, i) => [a.id, activity(a.id, states[i]!)]),
    );
    const model = islandAgents([lead, ...children], activities, "old");
    assert.equal(model.leadId, "lead");
    assert.equal(model.total, children.length);
    assert.equal(model.running, 1);
    assert.deepEqual(
      model.rows.map((r) => r.agent.id),
      ["attention", "error", "unknown", "wait", "working", "stop", "old"],
    );
    const old = model.rows.find((r) => r.agent.id === "old")!;
    assert.equal(old.viewed, true);
    assert.equal(old.agent.task, children[0]!.task);
    assert.equal(old.name, "old");
    assert.equal(old.profile, "explore");
  });

  it("works without a lead and does not count waits/errors as running", () => {
    const model = islandAgents(
      [agent("wait"), agent("error")],
      {
        wait: activity("wait", "awaiting_async"),
        error: activity("error", "error"),
      },
      "wait",
    );
    assert.equal(model.leadId, undefined);
    assert.equal(model.running, 0);
    assert.equal(islandCount(model.running, model.total), "2");
    assert.equal(islandCount(1, 7), "1/7");
  });

  it("keeps all running commands and five newest settled, counting only accessible rows", () => {
    const settled = Array.from({ length: 8 }, (_, i) =>
      command(`s${i}`, "completed", i),
    );
    const running = Array.from({ length: 6 }, (_, i) =>
      command(`r${i}`, "running", i),
    );
    const result = islandCommands([...settled, ...running].reverse());
    assert.equal(result.total, 11);
    assert.equal(result.total, result.rows.length + result.folded.length);
    assert.equal(islandCount(result.running, result.total), "6/11");
    assert.equal(islandCommands(settled).total, 5);
    assert.equal(result.running, 6);
    assert.deepEqual(
      [...result.rows, ...result.folded].map((r) => r.id),
      [...running.map((r) => r.id), "s0", "s1", "s2", "s3", "s4"],
    );
  });

  it("does not discard failed, timed out, cancelled or lost commands or fake success", () => {
    const statuses: AsyncBash["status"][] = [
      "failed",
      "timed_out",
      "cancelled",
      "lost",
    ];
    const rows = statuses.map((s) => command(s, s));
    assert.equal(islandCommands(rows).rows.length, 4);
    assert.deepEqual(
      statuses.map((s) => COMMAND_STATE_LABEL[s]),
      ["Failed", "Timed out", "Cancelled", "Lost"],
    );
    assert.equal(islandCommands([]).total, 0);
  });
});

describe("activity island folding", () => {
  it("shows short lists in full and never hides a single overflow row", () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      command(`s${i}`, "completed", i),
    );
    assert.equal(islandCommands(seven.slice(0, 5)).folded.length, 0);
    const oneOver = islandCommands([command("r", "running"), ...seven]);
    assert.equal(oneOver.rows.length, 6);
    assert.equal(oneOver.folded.length, 0);
  });

  it("folds only the oldest settled overflow; live rows never fold", () => {
    const running = Array.from({ length: 3 }, (_, i) =>
      command(`r${i}`, "running", i),
    );
    const settled = Array.from({ length: 5 }, (_, i) =>
      command(`s${i}`, "failed", i),
    );
    const result = islandCommands([...settled, ...running]);
    assert.deepEqual(
      result.rows.map((c) => c.id),
      ["r0", "r1", "r2", "s0", "s1", "s2"],
    );
    assert.deepEqual(
      result.folded.map((c) => c.id),
      ["s3", "s4"],
    );
    assert.equal(result.total, 8);
  });

  it("splits by prompt order even when older agents have newer activity", () => {
    const agents = Array.from({ length: 10 }, (_, i) => agent(`a${i}`, i));
    const older = agents[8]!;
    older.updatedAt = at(-100);
    const model = islandAgents([...agents].reverse(), {}, "lead");
    assert.deepEqual(
      model.rows.map((row) => row.agent.id),
      agents.slice(0, 6).map((a) => a.id),
    );
    assert.deepEqual(
      model.folded.map((row) => row.agent.id),
      agents.slice(6).map((a) => a.id),
    );
    // Pinning an old active child extends the prefix; it never jumps above
    // newer prompts, including when the older section is expanded.
    const active = islandAgents(
      agents,
      { a8: activity("a8", "running") },
      "lead",
    );
    assert.deepEqual(
      [...active.rows, ...active.folded].map((row) => row.agent.id),
      agents.map((a) => a.id),
    );
    assert.ok(active.rows.some((row) => row.agent.id === "a8"));
  });

  it("keeps attention states and the viewed agent visible", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "asks", "viewed"];
    const agents = ids.map((id, i) => agent(id, i));
    const activities = Object.fromEntries(
      ids.map((id) => [
        id,
        activity(id, id === "asks" ? "awaiting_user" : "idle"),
      ]),
    );
    const model = islandAgents(agents, activities, "viewed");
    assert.equal(model.rows[0]!.agent.id, "a");
    assert.ok(model.rows.some((r) => r.agent.id === "viewed"));
    assert.deepEqual(
      model.rows.map((r) => r.agent.id),
      ids,
    );
    assert.deepEqual(model.folded, []);
  });
});

describe("activity island command labels", () => {
  it("shows only the first command line without mutating retained full text", () => {
    const full = "  echo hello\r\nsecond line";
    assert.equal(commandFirstLine(full), "echo hello");
    assert.equal(commandFirstLine("\n "), "(empty command)");
  });
});
