import assert from "node:assert/strict";
import { it } from "node:test";
import { conversationStream } from "@nervekit/contracts/events";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  type ProtocolV1Message,
} from "@nervekit/contracts/wire";
import { createMessageFactory } from "../../src/index.js";
import { ProtocolClientSession } from "../../src/client.js";
import { ProtocolServerSession } from "../../src/server.js";

it("notify followed by awaited flush delivers before subsequent durable supersession", async () => {
  const stream = conversationStream("conversation1");
  const order: string[] = [];
  const capabilities = [
    "encoding.json",
    "event.batch",
    "event.notify",
    STREAM_SUBSCRIPTION_CAPABILITY,
  ];
  const server = new ProtocolServerSession({
    acceptingPeer: { role: "workbench_server", id: "server1" },
    createMessage: createMessageFactory({
      source: { role: "workbench_server", id: "server1" },
      target: { role: "ui", id: "ui1" },
    }),
    capabilities,
    limits: {
      maxMessageBytes: 1000000,
      maxBatchEvents: 500,
      maxBatchBytes: 1000000,
    },
    heartbeat: { intervalMs: 60000, timeoutMs: 120000 },
    sessionId: () => "session1",
    send: (message) => client.receive(message as ProtocolV1Message),
    subscriptions: {
      resolve: () => ({
        accepted: true,
        streams: [{ stream, latestSeq: 0, earliestAvailableSeq: 0 }],
      }),
    },
    readStream: () => ({
      stream,
      latestSeq: 0,
      earliestAvailableSeq: 0,
      events: [],
    }),
  });
  const client = new ProtocolClientSession({
    createMessage: createMessageFactory({
      source: { role: "ui", id: "ui1" },
      target: { role: "workbench_server", id: "server1" },
    }),
    capabilities,
    send: (message) => server.receive(message as ProtocolV1Message),
    onNotify: () => {
      order.push("preview");
    },
    applyEvent: () => {
      order.push("durable");
    },
  });
  try {
    assert.equal(server.isStreamActive(stream), false);
    await client.start();
    assert.equal(server.isStreamActive(stream), false);
    await client.subscribe([{ stream, processedSeq: 0 }]);
    assert.equal(server.isStreamActive(stream), true);
    await server.notify({
      id: "evt_preview1",
      ts: new Date().toISOString(),
      type: "conversation.live",
      data: {
        conversationId: "conversation1",
        delta: {
          type: "tool_call_arguments",
          turnId: "turn1",
          contentIndex: 0,
          providerCallId: "call1",
          name: "write",
          partialArgsText: '{"content":"final"}',
        },
      },
    });
    await server.flush();
    await server.publish(stream, {
      seq: 1,
      id: "evt_durable1",
      ts: new Date().toISOString(),
      type: "conversation.event",
      data: {},
    });
    await server.flush();
    assert.deepEqual(order, ["preview", "durable"]);
    server.removeStream(stream);
    assert.equal(server.isStreamActive(stream), false);
  } finally {
    client.disconnect();
    server.dispose();
  }
});
