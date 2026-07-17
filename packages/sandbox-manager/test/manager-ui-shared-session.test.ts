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
import { prepareManagerUiSharedSession } from "../src/protocol/manager-ui-shared-session.js";
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
  "operation.pinnedCommand.list",
  "operation.task.list",
];

test("manager UI adapter publishes only manager and selected sandbox streams", async () => {
  const http = createServer();
  const sockets = new WebSocketServer({ server: http });
  const eventBus = new ManagerEventBus();
  const forwarded: Array<{
    method: string;
    params: unknown;
    lineage: unknown;
  }> = [];
  const sandboxRecord = {
    sandboxId: "a",
    lifecycleState: "ready",
    desiredState: "running",
    observedState: "running",
  };
  const state = {
    config: { heartbeatTimeoutMs: 45_000 },
    sandboxes: {
      list: async () => [{ sandboxId: "a" }, { sandboxId: "b" }],
      get: async (sandboxId: string) =>
        sandboxId === "a" ? sandboxRecord : undefined,
    },
    pinnedCommands: { list: async () => [] },
    events: {
      list: async () => [],
      streamState: async () => ({ latestSeq: 0, durableSeq: 0 }),
    },
    eventBus,
    logger: { warn: () => undefined },
  } as unknown as ManagerState;
  const controller = {
    getSession: (sandboxId: string) =>
      sandboxId === "a"
        ? {
            socket: {},
            forwarder: {
              send: async (
                _socket: unknown,
                method: string,
                params: unknown,
                _idempotencyKey: string | undefined,
                _timeoutMs: number,
                lineage: unknown,
              ) => {
                forwarded.push({ method, params, lineage });
                return { tasks: [] };
              },
            },
          }
        : undefined,
  } as unknown as SandboxWsServer;
  sockets.on("connection", (socket) => {
    void prepareManagerUiSharedSession(state, controller).then((attach) =>
      attach(socket),
    );
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

    const managerResult = await connection.request(
      "pinnedCommand.list",
      { sandboxId: "a" },
      { target: { role: "sandbox_manager", id: "sandbox-manager" } },
    );
    assert.deepEqual(managerResult, { commands: [] });

    const agentResult = await connection.request(
      "task.list",
      {},
      {
        target: { role: "sandbox_agent", id: "a" },
        correlationId: "upstream_correlation",
        traceId: "trace_manager_ui",
      },
    );
    assert.deepEqual(agentResult, { tasks: [] });
    assert.equal(forwarded[0]?.method, "task.list");
    assert.deepEqual(forwarded[0]?.params, {});
    assert.deepEqual(forwarded[0]?.lineage, {
      correlationId: "upstream_correlation",
      causationId: forwarded[0]
        ? (forwarded[0].lineage as { causationId?: string }).causationId
        : undefined,
      traceId: "trace_manager_ui",
    });
    assert.ok(
      (
        forwarded[0]?.lineage as { causationId?: string }
      ).causationId?.startsWith("msg_"),
    );

    await assert.rejects(
      connection.request(
        "task.list",
        {},
        {
          target: { role: "sandbox_agent", id: "b" },
        },
      ),
    );
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
