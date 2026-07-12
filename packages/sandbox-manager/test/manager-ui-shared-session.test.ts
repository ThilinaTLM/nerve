import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  createMessageFactory,
  nodeWebSocketTransportFactory,
  ProtocolClientConnection,
  ProtocolClientSession,
  type WebSocketLike,
} from "@nervekit/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { ManagerState } from "../src/app/manager-state.js";
import { ManagerEventBus } from "../src/events/manager-event-bus.js";
import { createManagerUiSharedSession } from "../src/protocol/manager-ui-shared-session.js";
import type { SandboxWsServer } from "../src/protocol/sandbox-ws-server.js";

const capabilities = [
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "sandbox.manager.ui.v1",
  "sandbox.manager.snapshots.v1",
  "operation.sandbox.manager.recovery.get",
  "sandbox.manager.lifecycle.v1",
];

test("manager UI adapter publishes only manager and selected sandbox streams", async () => {
  const http = createServer();
  const sockets = new WebSocketServer({ server: http });
  const eventBus = new ManagerEventBus();
  const state = {
    config: { heartbeatTimeoutMs: 45_000 },
    sandboxes: {
      list: async () => [{ sandboxId: "a" }, { sandboxId: "b" }],
    },
    events: { list: async () => [] },
    eventBus,
    logger: { warn: () => undefined },
  } as unknown as ManagerState;
  sockets.on("connection", (socket) => {
    void createManagerUiSharedSession(socket, state, {} as SandboxWsServer);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert.ok(address && typeof address === "object");

  const received: string[] = [];
  let ready!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const messages = createMessageFactory({
    source: { role: "ui", id: "ui_test", instanceId: "ui_instance" },
    target: { role: "sandbox_manager", id: "sandbox-manager" },
  });
  const connection = new ProtocolClientConnection({
    transport: nodeWebSocketTransportFactory(
      () =>
        new WebSocket(
          `ws://127.0.0.1:${address.port}`,
        ) as unknown as WebSocketLike,
    ),
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: messages,
        capabilities,
        requiredCapabilities: capabilities,
        cursors: () => [
          { stream: "manager", processedSeq: 0 },
          { stream: "sandbox:a", processedSeq: 0 },
        ],
        send,
        onDisconnect,
        onReady: () => ready(),
        applyEvent: (stream) => {
          received.push(stream);
        },
      }),
  });

  try {
    await connection.start();
    await readyPromise;
    eventBus.publish({
      type: "sandbox.lifecycle.changed",
      stream: "manager",
      seq: 1,
      id: "evt_manager_1",
      durability: "durable",
      payload: {},
    });
    eventBus.publish({
      type: "run.delta",
      stream: "sandbox:a",
      sandboxId: "a",
      seq: 1,
      id: "evt_a_1",
      durability: "transient",
      payload: {},
    });
    eventBus.publish({
      type: "run.delta",
      stream: "sandbox:b",
      sandboxId: "b",
      seq: 1,
      id: "evt_b_1",
      durability: "transient",
      payload: {},
    });
    await waitFor(() => received.length === 2);
    assert.deepEqual(received.sort(), ["manager", "sandbox:a"]);
  } finally {
    await connection.close();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for events");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
