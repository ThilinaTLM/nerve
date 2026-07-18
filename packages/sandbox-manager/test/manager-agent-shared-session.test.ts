import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createMessageFactory } from "@nervekit/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { ManagerState } from "../src/app/manager-state.js";
import { SandboxWsServer } from "../src/protocol/sandbox-ws-server.js";

const agentCapabilities = [
  "encoding.json",
  "event.batch",
  "event.notify",
  "stream.subscription.v1",
  "sandbox.runtime.v1",
  "sandbox.events.v1",
  "sandbox.snapshots.v1",
];

test("manager agent adapter rejects an identity that does not match its endpoint", async () => {
  const state = {
    sandboxes: {
      get: async () => ({
        sandboxId: "sbx_test",
        instanceId: "instance_test",
        desiredState: "running",
        controller: { token: "token" },
      }),
    },
    events: { list: async () => [], append: async () => true },
    eventBus: { publish: () => undefined },
    activity: undefined,
    logger: { warn: () => undefined },
  } as unknown as ManagerState;
  const controller = new SandboxWsServer(state);
  const http = createServer();
  const sockets = new WebSocketServer({ server: http });
  sockets.on("connection", (socket) => {
    void controller.acceptAgentConnection("sbx_test", socket);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert.ok(address && typeof address === "object");

  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.on("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const messages = createMessageFactory({
    source: {
      role: "sandbox_agent",
      id: "sbx_other",
      instanceId: "instance_test",
    },
    target: { role: "sandbox_manager", id: "sandbox-manager" },
  });
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as {
      kind: string;
      data: { sessionId?: string };
    };
    if (message.kind === "welcome" && message.data.sessionId) {
      socket.send(
        JSON.stringify(
          messages("ready", {
            sessionId: message.data.sessionId,
            status: "ready",
          }),
        ),
      );
    }
  });
  socket.send(
    JSON.stringify(
      messages("hello", {
        requestedVersion: 1,
        capabilities: agentCapabilities,
        requiredCapabilities: agentCapabilities,
        encodings: ["json"],
      }),
    ),
  );

  try {
    const result = await closed;
    assert.equal(result.code, 1008);
    assert.equal(result.reason, "session_rejected");
  } finally {
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
