import assert from "node:assert/strict";
import test from "node:test";
import type {
  EventEnvelope,
  ProtocolV1Message,
  StreamCursor,
  StreamState,
} from "@nervekit/contracts";
import { createMessageFactory } from "../src/messages.js";
import { ProtocolConnection } from "../src/connection.js";
import { ProtocolClientSession } from "../src/client-session.js";
import { createInMemoryTransportPair } from "../src/in-memory-transport.js";
import { ProtocolServerSession } from "../src/session.js";

const clientPeer = { role: "ui" as const, id: "ui_subscriptions" };
const serverPeer = {
  role: "sandbox_manager" as const,
  id: "sandbox-manager",
};
const capabilities = [
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "stream.subscription.v1",
];
const limits = {
  maxMessageBytes: 1_000_000,
  maxBatchEvents: 100,
  maxBatchBytes: 1_000_000,
  maxInflightBatches: 4,
  maxUnackedDurableEvents: 1_000,
};

function event(
  seq: number,
  durability: "durable" | "transient",
  type = `test.${durability}`,
): EventEnvelope {
  return {
    id: `evt_${type}_${seq}`,
    seq,
    type,
    ts: "2026-01-01T00:00:00.000Z",
    durability,
    data: {},
  };
}

test("dynamic subscription atomically replaces one sandbox while manager remains live", async () => {
  const [clientTransport, serverTransport] = createInMemoryTransportPair();
  const clientMessages = createMessageFactory({
    source: clientPeer,
    target: serverPeer,
  });
  const serverMessages = createMessageFactory({
    source: serverPeer,
    target: clientPeer,
  });
  let activeStates: StreamState[] = [
    { stream: "manager", latestSeq: 0, durableSeq: 0 },
    { stream: "sandbox:a", latestSeq: 0, durableSeq: 0 },
  ];
  const binding: {
    client?: ProtocolConnection;
    server?: ProtocolConnection;
  } = {};
  const received: string[] = [];
  const cursors: StreamCursor[] = [
    { stream: "manager", processedSeq: 0 },
    { stream: "sandbox:a", processedSeq: 0 },
  ];
  const server = new ProtocolServerSession({
    acceptingPeer: serverPeer,
    allowedPeerRoles: ["ui"],
    createMessage: serverMessages,
    capabilities,
    streams: () => activeStates,
    limits,
    heartbeat: { intervalMs: 60_000, timeoutMs: 120_000 },
    sessionId: () => "session_subscriptions",
    send: (message) => binding.server?.send(message as ProtocolV1Message),
    resume: () => ({ accepted: true, mode: "live" }),
    replaySource: {
      streams: () => activeStates,
      read: () => ({
        available: true,
        events: [],
        previousDurableSeq: 0,
        complete: true,
      }),
    },
    subscriptions: {
      resolve: (requested) =>
        requested.some((cursor) => cursor.stream === "sandbox:forbidden")
          ? { accepted: false, streams: [], reason: "forbidden" }
          : {
              accepted: true,
              streams: requested.map((cursor) => ({
                stream: cursor.stream,
                latestSeq: cursor.processedSeq,
                durableSeq: cursor.processedSeq,
              })),
            },
      activate: (_requested, states) => {
        activeStates = [...states];
      },
    },
  });
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    capabilities,
    requiredCapabilities: ["stream.subscription.v1"],
    cursors: () => cursors,
    send: (message) => binding.client?.send(message as ProtocolV1Message),
    applyEvent: (stream) => received.push(stream),
  });
  binding.client = new ProtocolConnection({
    transport: clientTransport,
    onMessage: (message) => client.receive(message),
  });
  binding.server = new ProtocolConnection({
    transport: serverTransport,
    onMessage: (message) => server.receive(message),
  });

  await client.start();
  await waitFor(() => client.state === "ready" && server.state === "ready");
  await assert.rejects(
    client.setSubscriptions([
      { stream: "manager", processedSeq: 0 },
      { stream: "sandbox:forbidden", processedSeq: 0 },
    ]),
    /forbidden/,
  );
  assert.deepEqual(
    activeStates.map((state) => state.stream),
    ["manager", "sandbox:a"],
  );

  const updated = await client.setSubscriptions([
    { stream: "manager", processedSeq: 0 },
    { stream: "sandbox:b", processedSeq: 0 },
  ]);
  assert.equal(updated.accepted, true);
  assert.deepEqual(
    activeStates.map((state) => state.stream),
    ["manager", "sandbox:b"],
  );

  await server.publish("sandbox:a", event(1, "transient"));
  await server.publish("manager", event(1, "transient"));
  await server.publish("sandbox:b", event(1, "transient"));
  await waitFor(() => received.length === 2);
  assert.deepEqual(received, ["manager", "sandbox:b"]);

  binding.client.dispose();
  binding.server.dispose();
  server.dispose();
});

test("live queue preserves mixed transient and durable sequence order", async () => {
  const [clientTransport, serverTransport] = createInMemoryTransportPair();
  const clientMessages = createMessageFactory({
    source: clientPeer,
    target: serverPeer,
  });
  const serverMessages = createMessageFactory({
    source: serverPeer,
    target: clientPeer,
  });
  const binding: {
    client?: ProtocolConnection;
    server?: ProtocolConnection;
  } = {};
  const received: number[] = [];
  const server = new ProtocolServerSession({
    acceptingPeer: serverPeer,
    allowedPeerRoles: ["ui"],
    createMessage: serverMessages,
    capabilities,
    streams: () => [{ stream: "manager", latestSeq: 3, durableSeq: 2 }],
    limits,
    heartbeat: { intervalMs: 60_000, timeoutMs: 120_000 },
    sessionId: () => "session_order",
    send: (message) => binding.server?.send(message as ProtocolV1Message),
    resume: () => ({ accepted: true, mode: "live" }),
  });
  await server.publish("manager", event(1, "transient"));
  await server.publish("manager", event(2, "durable"));
  await server.publish("manager", event(3, "transient"));
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    capabilities,
    cursors: () => [{ stream: "manager", processedSeq: 0 }],
    send: (message) => binding.client?.send(message as ProtocolV1Message),
    applyEvent: (_stream, value) => received.push(value.seq),
    processedEvents: { persist: () => undefined },
  });
  binding.client = new ProtocolConnection({
    transport: clientTransport,
    onMessage: (message) => client.receive(message),
  });
  binding.server = new ProtocolConnection({
    transport: serverTransport,
    onMessage: (message) => server.receive(message),
  });
  await client.start();
  await waitFor(() => received.length === 3);
  assert.deepEqual(received, [1, 2, 3]);

  binding.client.dispose();
  binding.server.dispose();
  server.dispose();
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for protocol");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
