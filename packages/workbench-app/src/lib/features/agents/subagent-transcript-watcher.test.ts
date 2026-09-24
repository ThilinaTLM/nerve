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

function canonical(
  seq: number,
  type: string,
  agentId: string,
  extra: Record<string, unknown> = {},
): EventEnvelope<Record<string, unknown>> {
  return {
    seq,
    id: `evt_${seq}`,
    ts,
    type,
    data: { conversationId: "conv_test", agentId, runId: "run_x", ...extra },
  };
}

function entryAppended(
  seq: number,
  agentId: string,
): EventEnvelope<Record<string, unknown>> {
  // Entry events carry no projectId; ownership comes from the entry agent.
  return {
    seq,
    id: `evt_${seq}`,
    ts,
    type: "conversation.entry.appended",
    data: {
      conversationId: "conv_test",
      entry: { id: `entry_${seq}`, agentId, role: "assistant", text: "hi" },
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

  it("delivers only canonical child events from the shared stream, in order", async () => {
    let handler: WorkbenchEventHandler | undefined;
    let fetchCount = 0;
    const watch = createSubagentTranscriptWatcher({
      subscribe: (next) => {
        handler = next;
        return () => undefined;
      },
      fetch: async () => (fetchCount++ === 0 ? snapshot(1) : snapshot(20)),
    });
    const received: Array<[number, string]> = [];
    const stop = watch("agent_parent", "agent_child", {
      snapshot: () => undefined,
      event: (next) => {
        received.push([next.seq, next.type]);
        return true;
      },
      error: assert.fail,
    });
    await tick();
    const interleaved = [
      canonical(2, "run.started", "agent_child", { projectId: "proj_test" }),
      canonical(3, "conversation.live.turn.started", "agent_parent"),
      canonical(4, "conversation.live.content.delta", "agent_child"),
      canonical(5, "conversation.live.content.delta", "agent_sibling"),
      entryAppended(6, "agent_parent"),
      entryAppended(7, "agent_child"),
      canonical(8, "toolCall.updated", "agent_sibling"),
      canonical(9, "conversation.context.updated", "agent_child"),
      canonical(10, "conversation.live.content.delta", "agent_child", {
        conversationId: "conv_other",
      }),
      canonical(11, "run.completed", "agent_parent"),
    ];
    for (const next of interleaved) await handler?.(next);
    assert.deepEqual(received, [
      [2, "run.started"],
      [4, "conversation.live.content.delta"],
      [7, "conversation.entry.appended"],
    ]);
    assert.equal(fetchCount, 1, "no gap or terminal reconcile for others");

    await handler?.(canonical(12, "run.completed", "agent_child"));
    await tick();
    assert.equal(fetchCount, 2, "canonical child completion reconciles once");
    await handler?.(canonical(21, "run.started", "agent_child"));
    await handler?.(canonical(22, "run.failed", "agent_child"));
    await tick();
    assert.equal(fetchCount, 3, "a later teammate run reconciles again");
    stop();
  });
});
