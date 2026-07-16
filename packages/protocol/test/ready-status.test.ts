import type { NerveMessage } from "@nervekit/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import { createMessageFactory, ProtocolClientSession } from "../src/index.js";

const clientPeer = { role: "ui" as const, id: "ui_ready_status" };
const serverPeer = {
  role: "workbench_server" as const,
  id: "server_ready_status",
};
const clientMessages = createMessageFactory({
  source: clientPeer,
  target: serverPeer,
});
const serverMessages = createMessageFactory({
  source: serverPeer,
  target: clientPeer,
});
const limits = {
  maxMessageBytes: 1_048_576,
  maxBatchEvents: 2,
  maxBatchBytes: 262_144,
  maxInflightBatches: 2,
  maxUnackedDurableEvents: 4,
};

test("client carries booting host status on the protocol ready frame", async () => {
  const outbound: NerveMessage[] = [];
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    send: (message) => outbound.push(message),
    readyStatus: () => "booting",
  });
  await client.start();
  await client.receive(
    serverMessages("welcome", {
      sessionId: "session_booting_status",
      acceptingPeer: serverPeer,
      acceptedVersion: 1,
      capabilities: [],
      encoding: "json",
      streams: [],
      limits,
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
      resume: { accepted: true, mode: "live" },
    }) as never,
  );
  const ready = outbound.find((message) => message.kind === "ready");
  assert.equal(ready?.data.status, "booting");
  await client.close();
});
