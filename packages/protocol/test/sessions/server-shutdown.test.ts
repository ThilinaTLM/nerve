import assert from "node:assert/strict";
import test from "node:test";
import type { ProtocolV1Message } from "@nervekit/contracts/wire";
import { createMessageFactory } from "../../src/index.js";
import { ProtocolServerSession } from "../../src/server.js";
import { RpcDispatcher } from "../../src/rpc/index.js";

const clientMessages = createMessageFactory({
  source: { role: "ui", id: "ui_shutdown" },
  target: { role: "workbench_server", id: "server_shutdown" },
});
const capabilities = [
  "stream.subscription.v1",
  "operation.status.latestRelease.get",
];

async function fixture(failure: () => void | Promise<void>) {
  let disconnected = false;
  const attempted: string[] = [];
  const server = new ProtocolServerSession({
    acceptingPeer: { role: "workbench_server", id: "server_shutdown" },
    createMessage: createMessageFactory({
      source: { role: "workbench_server", id: "server_shutdown" },
      target: { role: "ui", id: "ui_shutdown" },
    }),
    capabilities,
    limits: {
      maxMessageBytes: 1_000_000,
      maxBatchEvents: 100,
      maxBatchBytes: 1_000_000,
    },
    heartbeat: { intervalMs: 60_000, timeoutMs: 120_000 },
    sessionId: () => "session_shutdown",
    send: (message) => {
      attempted.push(message.kind);
      if (disconnected) return failure();
    },
    rpcDispatcher: new RpcDispatcher({
      acceptedCapabilities: capabilities,
      handlers: {
        "status.latestRelease.get": () => ({
          version: "1.0.0",
          releaseUrl: "https://example.com/release",
          publishedAt: "2026-01-01T00:00:00.000Z",
        }),
      },
    }),
  });
  await server.receive(
    clientMessages("hello", {
      requestedVersion: 1,
      capabilities,
      encodings: ["json"],
    }) as ProtocolV1Message,
  );
  await server.receive(
    clientMessages("ready", {
      sessionId: "session_shutdown",
    }) as ProtocolV1Message,
  );
  disconnected = true;
  attempted.length = 0;
  return { server, attempted };
}

for (const mode of ["throw", "reject"] as const) {
  test(`shutdown finalizes without rejecting when goodbye send ${mode}s`, async (t) => {
    const { server, attempted } = await fixture(() => {
      const error = new Error("WebSocket is not open");
      if (mode === "throw") throw error;
      return Promise.reject(error);
    });
    t.after(() => server.dispose());
    await assert.doesNotReject(server.shutdown());
    assert.equal(server.state, "closed");
    assert.deepEqual(attempted, ["goodbye"]);
    await server.shutdown();
    assert.deepEqual(attempted, ["goodbye"]);
  });
}

test("a detached RPC response failure shuts down without an unhandled rejection", async (t) => {
  const { server, attempted } = await fixture(() => {
    throw new Error("WebSocket is not open");
  });
  t.after(() => server.dispose());
  await server.receive(
    clientMessages("request", {
      method: "status.latestRelease.get",
      params: {},
    }) as ProtocolV1Message,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(server.state, "closed");
  assert.equal(attempted.at(-1), "goodbye");
  assert.ok(attempted.includes("response"));
});
