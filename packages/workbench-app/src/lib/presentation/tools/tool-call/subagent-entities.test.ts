import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeAgo,
  enrichEntities,
  promptEntities,
  statusEntities,
  stopEntities,
} from "./subagent-entities";

const promptView = {
  kind: "subagent",
  action: "prompt",
  assignments: [
    { name: "a", profile: "coder", prompt: "do a" },
    { name: "b", prompt: "do b" },
  ],
} as const;

describe("subagent entities", () => {
  it("keeps one keyed row per assignment and surfaces rejection reasons", () => {
    const items = promptEntities(
      { ...promptView, assignments: [...promptView.assignments] },
      {
        assignments: [
          { name: "a", disposition: "follow_up" },
          { name: "b", disposition: "rejected", reason: "no such profile" },
        ],
      },
    );
    assert.deepEqual(
      items.map((item) => item.key),
      ["0", "1"],
    );
    assert.equal(items[0].followUp, true);
    assert.equal(items[1].status?.tone, "destructive");
    assert.equal(items[1].body, "no such profile");
    assert.equal(items[1].agentName, undefined);
  });

  it("falls back to the argument rows before any result", () => {
    const items = promptEntities(
      { ...promptView, assignments: [...promptView.assignments] },
      undefined,
    );
    assert.equal(items[0].body, "do a");
    assert.equal(items[0].status, undefined);
  });

  it("formats status context and activity from details", () => {
    const now = Date.parse("2026-01-01T00:01:00Z");
    const items = statusEntities(
      { kind: "subagent", action: "status", rows: [] },
      {
        agents: [
          {
            name: "a",
            state: "running",
            contextPercent: 33.6,
            lastActivityAt: "2026-01-01T00:00:40Z",
          },
        ],
      },
      now,
    );
    assert.equal(items[0].body, "ctx 34% · active 20s ago");
    assert.equal(items[0].status?.tone, "info");
    assert.equal(activeAgo("garbage"), undefined);
  });

  it("fills persistent argument rows from a settled stop result", () => {
    const toolCall = {
      id: "t",
      toolName: "subagent_stop",
      status: "completed",
      argsPreview: { names: ["a", "b"] },
      resultPreview: {
        content: "a: stopped",
        details: {
          results: [
            { name: "a", outcome: "stopped", runMs: 2000 },
            { name: "b", outcome: "not_found" },
          ],
        },
      },
    } as unknown as Parameters<typeof enrichEntities>[0];
    const items = enrichEntities(toolCall, [
      { key: "0", title: "a", agentName: "a" },
      { key: "1", title: "b", agentName: "b" },
    ]);
    assert.equal(items[0].body, "stopped · ran 2.0s");
    assert.equal(items[1].status?.tone, "warning");
    assert.equal(items[1].key, "1");
  });

  it("reports stop outcome with run duration", () => {
    const items = stopEntities(
      { kind: "subagent", action: "stop", names: ["a"], lines: [] },
      { results: [{ name: "a", outcome: "stopped", runMs: 94_000 }] },
    );
    assert.equal(items[0].body, "stopped · ran 94.0s");
  });
});
