import type { EventEnvelope } from "@nervekit/contracts/events";
import type { SubagentTranscriptSnapshot } from "@nervekit/contracts/agents";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkbenchEventHandler } from "$lib/application/events/event-bus";
import { createSubagentTranscriptWatcher } from "./subagent-transcript-watcher.js";

const ts = "2026-08-02T00:00:00.000Z";

function snapshot(
  cursorSeq: number,
  status: "running" | "idle" = "running",
): SubagentTranscriptSnapshot {
  return {
    agentId: "agent_child",
    parentAgentId: "agent_parent",
    conversationId: "conv_test",
    projectId: "proj_test",
    cursorSeq,
    status,
    entries: [],
    toolCalls: [],
    totalEntryCount: 0,
    totalToolCallCount: 0,
    entriesTruncated: false,
    toolCallsTruncated: false,
    updatedAt: ts,
  };
}

function event(
  seq: number,
  type = "agent.subagent_transcript.turn.started",
  childAgentId = "agent_child",
): EventEnvelope<Record<string, unknown>> {
  return {
    seq,
    id: `evt_${seq}`,
    ts,
    type,
    data: {
      conversationId: "conv_test",
      projectId: "proj_test",
      parentAgentId: "agent_parent",
      childAgentId,
      runId: "run_child",
      turnId: "turn_child",
      ordinal: 0,
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("subagent transcript watcher", () => {
  it("subscribes before fetch, replays newer matching events, final-reconciles, and disposes", async () => {
    const order: string[] = [];
    const snapshots = [snapshot(4), snapshot(9, "idle")];
    let handler: WorkbenchEventHandler | undefined;
    let fetchCount = 0;
    let disposed = false;
    const watch = createSubagentTranscriptWatcher({
      subscribe: (next) => {
        order.push("subscribe");
        handler = next;
        return () => {
          disposed = true;
        };
      },
      fetch: async () => {
        order.push("fetch");
        return snapshots[fetchCount++]!;
      },
    });
    const received: number[] = [];
    const reconciled: number[] = [];
    const stop = watch("agent_parent", "agent_child", {
      snapshot: (next) => reconciled.push(next.cursorSeq),
      event: (next) => {
        received.push(next.seq);
      },
      error: assert.fail,
    });
    assert.deepEqual(order, ["subscribe", "fetch"]);
    await handler?.(event(3));
    await handler?.(event(6, undefined, "agent_sibling"));
    await handler?.(event(5));
    await tick();
    assert.deepEqual(reconciled, [4]);
    assert.deepEqual(received, [5]);

    await handler?.(event(9, "agent.subagent_transcript.run.completed"));
    await tick();
    assert.equal(fetchCount, 2);
    assert.deepEqual(reconciled, [4, 9]);
    stop();
    assert.equal(disposed, true);
    await handler?.(event(10));
    assert.deepEqual(received, [5, 9]);
  });

  it("coalesces offset-gap recovery without removing the current observer state", async () => {
    let handler: WorkbenchEventHandler | undefined;
    let resolveRecovery:
      | ((value: SubagentTranscriptSnapshot) => void)
      | undefined;
    let fetchCount = 0;
    const watch = createSubagentTranscriptWatcher({
      subscribe: (next) => {
        handler = next;
        return () => undefined;
      },
      fetch: () => {
        fetchCount += 1;
        if (fetchCount === 1) return Promise.resolve(snapshot(1));
        return new Promise((resolve) => {
          resolveRecovery = resolve;
        });
      },
    });
    const reconciled: number[] = [];
    const stop = watch("agent_parent", "agent_child", {
      snapshot: (next) => reconciled.push(next.cursorSeq),
      event: () => false,
      error: assert.fail,
    });
    await tick();
    await handler?.(event(2));
    await handler?.(event(3));
    assert.equal(fetchCount, 2);
    assert.deepEqual(reconciled, [1]);
    resolveRecovery?.(snapshot(3));
    await tick();
    assert.deepEqual(reconciled, [1, 3]);
    stop();
  });
});
