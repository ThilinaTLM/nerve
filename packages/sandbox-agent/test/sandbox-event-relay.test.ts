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
  maxInflightBatches: 1,
  maxUnackedDurableEvents: 1_000,
};

function durableData(runId: string) {
  return {
    conversationId: "conv_1",
    agentId: "agent_1",
    projectId: "proj_1",
    runId,
    startedAt: "2026-01-01T00:00:00.000Z",
  };
}

function transientData() {
  return {
    conversationId: "conv_1",
    agentId: "agent_1",
    runId: "run_1",
    deltaId: "delta_1",
    role: "assistant" as const,
    text: "working",
  };
}

test("relay sends mixed events in order, waits for ACK capacity, and replays only durable state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-event-relay-"));
  try {
    const outbox = new EventOutbox(
      path.join(dir, "outbox.jsonl"),
      path.join(dir, "ack.json"),
    );
    await outbox.load();
    await outbox.append({
      id: "evt_durable_1",
      type: "run.started",
      durability: "durable",
      data: durableData("run_1"),
    });
    const firstConnection: Array<
      Extract<ProtocolV1Message, { kind: "event.batch" }>["data"]
    > = [];
    const firstSession = {
      state: "ready",
      publishEventBatch: async (
        data: Extract<ProtocolV1Message, { kind: "event.batch" }>["data"],
      ) => void firstConnection.push(data),
    } as unknown as ProtocolClientSession;
    const relay = new SandboxEventRelay(outbox, "sandbox:one", undefined, 5);
    relay.start();
    const generation = await relay.attach(firstSession, limits);
    assert.deepEqual(
      firstConnection[0]?.events.map((event) => event.seq),
      [1],
    );

    await Promise.all([
      outbox.append({
        type: "run.delta",
        durability: "transient",
        data: transientData(),
      }),
      outbox.append({
        id: "evt_durable_3",
        type: "run.started",
        durability: "durable",
        data: durableData("run_2"),
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(firstConnection.length, 1);

    await relay.acknowledge(
      {
        kind: "event.ack",
        data: {
          ackId: firstConnection[0]?.batchId,
          streams: [{ stream: "sandbox:one", processedSeq: 1 }],
        },
      } as ProtocolV1Message & { kind: "event.ack" },
      generation,
    );
    assert.deepEqual(
      firstConnection[1]?.events.map((event) => event.seq),
      [2, 3],
    );

    relay.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const secondConnection: Array<
      Extract<ProtocolV1Message, { kind: "event.batch" }>["data"]
    > = [];
    const secondSession = {
      state: "ready",
      publishEventBatch: async (
        data: Extract<ProtocolV1Message, { kind: "event.batch" }>["data"],
      ) => void secondConnection.push(data),
    } as unknown as ProtocolClientSession;
    await relay.attach(secondSession, limits);
    assert.deepEqual(
      secondConnection[0]?.events.map((event) => event.seq),
      [3],
    );
    relay.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
