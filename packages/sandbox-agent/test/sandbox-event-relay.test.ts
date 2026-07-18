import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ProtocolV1Message } from "@nervekit/contracts";
import type { ProtocolClientSession } from "@nervekit/protocol";
import { SandboxEventRelay } from "../src/protocol/sandbox-event-relay.js";
import { EventOutbox } from "../src/state/event-outbox.js";

const limits = {
  maxMessageBytes: 1_000_000,
  maxBatchEvents: 100,
  maxBatchBytes: 1_000_000,
};

function sequencedData(runId: string) {
  return {
    conversationId: "conv_1",
    agentId: "agent_1",
    projectId: "proj_1",
    runId,
    startedAt: "2026-01-01T00:00:00.000Z",
  };
}

function notifyData() {
  return {
    conversationId: "conv_1",
    agentId: "agent_1",
    runId: "run_1",
    deltaId: "delta_1",
    role: "assistant" as const,
    text: "working",
  };
}

test("relay fails loudly when the retained same-epoch outbox has a gap", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-event-relay-gap-"));
  try {
    const outbox = new EventOutbox(
      path.join(dir, "outbox.jsonl"),
      path.join(dir, "meta.json"),
    );
    await outbox.load();
    await outbox.append({
      id: "evt_gap_1",
      type: "run.started",
      data: sequencedData("run_1"),
    });
    await outbox.append({
      id: "evt_gap_2",
      type: "run.started",
      data: sequencedData("run_2"),
    });
    await outbox.truncateThrough(1);
    const session = {
      state: "ready",
      subscribe: async () => ({
        accepted: true,
        streams: [
          {
            stream: "sandbox:gap",
            latestSeq: 0,
            earliestAvailableSeq: 1,
            mode: "live" as const,
          },
        ],
      }),
      publishEventBatch: async () => undefined,
      publishNotify: async () => undefined,
    } as unknown as ProtocolClientSession;
    const relay = new SandboxEventRelay(outbox, "sandbox:gap");

    await assert.rejects(
      relay.attach(session, limits),
      /outbox gap.*expected 1.*2/i,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("relay sends dense batches, bypasses notify, and reconciles through subscriptions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-event-relay-"));
  try {
    const outbox = new EventOutbox(
      path.join(dir, "outbox.jsonl"),
      path.join(dir, "meta.json"),
      path.join(dir, "ack.json"),
    );
    await outbox.load();
    await outbox.append({
      id: "evt_sequenced_1",
      type: "run.started",
      data: sequencedData("run_1"),
    });

    const batches: Array<
      Extract<ProtocolV1Message, { kind: "event.batch" }>["data"]
    > = [];
    const notifications: Array<
      Extract<ProtocolV1Message, { kind: "event.notify" }>["data"]
    > = [];
    let managerLatestSeq = 0;
    const session = {
      state: "ready",
      publishEventBatch: async (
        data: Extract<ProtocolV1Message, { kind: "event.batch" }>["data"],
      ) => {
        batches.push(data);
        managerLatestSeq = data.lastSeq ?? managerLatestSeq;
      },
      publishNotify: async (
        data: Extract<ProtocolV1Message, { kind: "event.notify" }>["data"],
      ) => void notifications.push(data),
      subscribe: async () => ({
        sessionId: "session_1",
        subscriptionId: "subscription_1",
        accepted: true,
        streams: [
          {
            stream: "sandbox:one",
            latestSeq: managerLatestSeq,
            earliestAvailableSeq: managerLatestSeq > 0 ? 1 : 1,
            mode: "live" as const,
          },
        ],
      }),
    } as unknown as ProtocolClientSession;

    const relay = new SandboxEventRelay(outbox, "sandbox:one", undefined, 5);
    relay.start();
    await relay.attach(session, limits);
    assert.deepEqual(
      batches[0]?.events.map((event) => event.seq),
      [1],
    );
    assert.equal(
      outbox.all().length,
      0,
      "subscription cursor prunes delivered tail",
    );

    await Promise.all([
      outbox.append({ type: "run.delta", data: notifyData() }),
      outbox.append({
        id: "evt_sequenced_2",
        type: "run.started",
        data: sequencedData("run_2"),
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(
      batches[1]?.events.map((event) => event.seq),
      [2],
    );
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.events[0]?.type, "run.delta");
    assert.equal("seq" in (notifications[0]?.events[0] ?? {}), false);

    relay.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const replayed: unknown[] = [];
    const secondSession = {
      ...session,
      publishEventBatch: async (data: unknown) => void replayed.push(data),
    } as unknown as ProtocolClientSession;
    await relay.attach(secondSession, limits);
    assert.equal(replayed.length, 0);
    relay.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
