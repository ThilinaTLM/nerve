import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventBatch,
  createMessageFactory,
  ProtocolClientSession,
  ProtocolServerSession,
} from "../src/index.js";

const ui = { role: "ui" as const, id: "ui_target_test" };
const server = { role: "workbench_server" as const, id: "server_target_test" };
const clientMessages = createMessageFactory({ source: ui, target: server });
const serverMessages = createMessageFactory({ source: server, target: ui });
const limits = {
  maxMessageBytes: 1_048_576,
  maxBatchEvents: 100,
  maxBatchBytes: 262_144,
  maxInflightBatches: 4,
  maxUnackedDurableEvents: 1_000,
};

test("client rejects a welcome that changes an explicitly addressed server id", async () => {
  const addressedMessages = createMessageFactory({
    source: ui,
    target: { role: "workbench_server", id: "expected_server" },
  });
  const client = new ProtocolClientSession({
    createMessage: addressedMessages,
    send: () => undefined,
  });
  await client.start();
  await assert.rejects(
    client.receive(
      serverMessages("welcome", {
        sessionId: "session_wrong_server",
        acceptingPeer: server,
        acceptedVersion: 1,
        capabilities: [],
        encoding: "json",
        streams: [],
        limits,
        heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
        resume: { accepted: true, mode: "live" },
      }) as never,
    ),
    /addressed client session/,
  );
});

test("server host target policy permits authorized alternate targets only", async () => {
  let applied = 0;
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [],
    limits,
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_target_policy",
    send: () => undefined,
    authorizeTarget: (message, context) =>
      samePeer(message.target, context.negotiatedTarget) ||
      (message.target.role === "sandbox_agent" &&
        message.target.id === "sandbox_allowed"),
    onEventBatch: () => {
      applied += 1;
      return { streams: [] };
    },
  });
  await host.receive(clientMessages("hello", helloData()) as never);
  await host.receive(
    clientMessages("ready", { sessionId: "session_target_policy" }) as never,
  );
  const batch = buildEventBatch(
    [
      {
        id: "evt_alternate_target",
        seq: 1,
        type: "project.created",
        ts: new Date().toISOString(),
        durability: "durable",
        data: {},
      },
    ],
    {
      stream: "sandbox:sandbox_allowed",
      reason: "live",
      previousDurableSeq: 0,
    },
  );
  await host.receive(
    clientMessages("event.batch", batch, {
      target: { role: "sandbox_agent", id: "sandbox_allowed" },
    }) as never,
  );
  assert.equal(applied, 1);
  await host.receive(
    clientMessages("event.batch", batch, {
      target: { role: "sandbox_agent", id: "sandbox_denied" },
    }) as never,
  );
  assert.equal(applied, 1);
  assert.equal(host.state, "closed");
});

function helloData() {
  return {
    requestedVersion: 1 as const,
    capabilities: ["rpc"],
    encodings: ["json" as const],
  };
}
function samePeer(
  left: { role: string; id?: string; instanceId?: string; name?: string },
  right: { role: string; id?: string; instanceId?: string; name?: string },
): boolean {
  return (
    left.role === right.role &&
    left.id === right.id &&
    left.instanceId === right.instanceId &&
    left.name === right.name
  );
}
