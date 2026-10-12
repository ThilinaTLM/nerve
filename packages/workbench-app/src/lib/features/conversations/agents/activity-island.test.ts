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
    mode: "coding",
    createdAt: at(age + 100),
    updatedAt: at(age),
    parentAgentId: "lead",
    name: ` ${id} `,
    task: `Full prompt for ${id}\nSecond line`,
    subagentProfile: "explore",
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
      ["attention", "working", "wait", "error", "unknown", "stop", "old"],
    );
    const old = model.rows.find((r) => r.agent.id === "old")!;
    assert.equal(old.recent, true);
    assert.equal(old.viewed, true);
    assert.equal(old.agent.task, children[0]!.task);
    assert.equal(old.name, "old");
    assert.equal(old.profile, "explore");
    assert.equal(model.rows.find((r) => r.agent.id === "error")!.recent, false);
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
    assert.equal(result.total, result.rows.length);
    assert.equal(islandCount(result.running, result.total), "6/11");
    assert.equal(islandCommands(settled).total, 5);
    assert.equal(result.running, 6);
    assert.deepEqual(
      result.rows.map((r) => r.id),
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

describe("activity island command labels", () => {
  it("shows only the first command line without mutating retained full text", () => {
    const full = "  echo hello\r\nsecond line";
    assert.equal(commandFirstLine(full), "echo hello");
    assert.equal(commandFirstLine("\n "), "(empty command)");
  });
});
