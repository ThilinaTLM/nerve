import type { NerveMessage } from "@nervekit/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import { ProtocolServerSession, createMessageFactory } from "../src/index.js";

const ui = { role: "ui" as const, id: "ui_live" };
const server = { role: "workbench_server" as const, id: "server_live" };
const clientMessages = createMessageFactory({ source: ui, target: server });
const serverMessages = createMessageFactory({ source: server, target: ui });

test("server reports replay source gaps without completing replay", async () => {
  const outbound: NerveMessage[] = [];
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [
      {
        stream: "manager",
        latestSeq: 4,
        durableSeq: 4,
        replayAvailableFromSeq: 1,
      },
    ],
    replaySource: {
      streams: () => [
        {
          stream: "manager",
          latestSeq: 4,
          durableSeq: 4,
          replayAvailableFromSeq: 1,
        },
      ],
      read: () => ({
        available: false,
        reason: "storage_unavailable",
        latestSeq: 4,
        recovery: { action: "load_snapshot" },
      }),
    },
    limits: {
      maxMessageBytes: 1_048_576,
      maxBatchEvents: 2,
      maxBatchBytes: 262_144,
      maxInflightBatches: 2,
      maxUnackedDurableEvents: 4,
    },
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_gap",
    send: (message) => outbound.push(message),
  });
  await host.receive(
    clientMessages("hello", {
      requestedVersion: 1,
      capabilities: [],
      encodings: ["json"],
    }) as never,
  );
  await host.receive(
    clientMessages("ready", { sessionId: "session_gap" }) as never,
  );
  outbound.length = 0;
  await host.receive(
    clientMessages("replay.request", {
      sessionId: "session_gap",
      replayId: "rpl_gap",
      streams: [{ stream: "manager", fromSeq: 2, toSeq: 4 }],
      reason: "manual_refresh",
    }) as never,
  );
  assert.deepEqual(
    outbound.map((message) => message.kind),
    ["replay.started", "replay.unavailable"],
  );
});

test("server buffers live durable events until ready", async () => {
  const outbound: NerveMessage[] = [];
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    allowedPeerRoles: ["ui"],
    createMessage: serverMessages,
    streams: () => [
      {
        stream: "manager",
        latestSeq: 1,
        durableSeq: 1,
        replayAvailableFromSeq: 1,
      },
    ],
    limits: {
      maxMessageBytes: 1_048_576,
      maxBatchEvents: 2,
      maxBatchBytes: 262_144,
      maxInflightBatches: 2,
      maxUnackedDurableEvents: 4,
    },
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_buffered",
    send: (message) => outbound.push(message),
  });
  await host.receive(
    clientMessages("hello", {
      requestedVersion: 1,
      capabilities: [],
      encodings: ["json"],
    }) as never,
  );
  await host.publish("manager", {
    seq: 1,
    id: "evt_buffered",
    ts: new Date().toISOString(),
    type: "project.created",
    durability: "durable",
    data: {},
  });
  assert.deepEqual(
    outbound.map((message) => message.kind),
    ["welcome"],
  );
  await host.receive(
    clientMessages("ready", { sessionId: "session_buffered" }) as never,
  );
  assert.deepEqual(
    outbound.map((message) => message.kind),
    ["welcome", "event.batch"],
  );
});
