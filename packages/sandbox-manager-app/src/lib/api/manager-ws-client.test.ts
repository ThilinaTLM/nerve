import assert from "node:assert/strict";
import test from "node:test";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  allOperationDefinitions,
  type ProtocolV1Message,
  type StreamCursor,
} from "@nervekit/contracts";
import {
  createInMemoryTransportPair,
  createMessageFactory,
  ProtocolConnection,
  ProtocolServerSession,
  type TransportFactory,
} from "@nervekit/protocol";
import { ManagerWsClient } from "./manager-ws-client.svelte";

const rpcCapabilities = allOperationDefinitions()
  .filter(
    (definition) =>
      definition.allowedTargetRoles.includes("sandbox_manager") ||
      definition.allowedTargetRoles.includes("sandbox_agent"),
  )
  .map((definition) => definition.requiredCapability)
  .filter((capability): capability is string => Boolean(capability));

const capabilities = [
  "encoding.json",
  "event.batch",
  "event.notify",
  STREAM_SUBSCRIPTION_CAPABILITY,
  "sandbox.manager.ui.v1",
  "sandbox.manager.snapshots.v1",
  "operation.sandbox.manager.recovery.get",
  "sandbox.manager.lifecycle.v1",
  ...rpcCapabilities,
];
const limits = {
  maxMessageBytes: 1_000_000,
  maxBatchEvents: 100,
  maxBatchBytes: 1_000_000,
};

test("ManagerWsClient keeps only the latest selection generation and installs exact cursors", async () => {
  const subscriptions: StreamCursor[][] = [];
  const servers: ProtocolConnection[] = [];
  const transportFactory = (): TransportFactory => ({
    async connect() {
      const [clientTransport, serverTransport] = createInMemoryTransportPair();
      const messages = createMessageFactory({
        source: { role: "sandbox_manager", id: "sandbox-manager" },
        target: { role: "ui", id: "ui_test", instanceId: "ui_instance" },
      });
      const binding: { connection?: ProtocolConnection } = {};
      const session = new ProtocolServerSession({
        acceptingPeer: { role: "sandbox_manager", id: "sandbox-manager" },
        allowedPeerRoles: ["ui"],
        createMessage: messages,
        capabilities,
        limits,
        heartbeat: { intervalMs: 60_000, timeoutMs: 120_000 },
        sessionId: () => "session_1",
        send: (message) =>
          binding.connection?.send(message as ProtocolV1Message),
        readStream: (stream, fromSeq) => ({
          stream,
          latestSeq: fromSeq - 1,
          earliestAvailableSeq: 1,
          events: [],
        }),
        subscriptions: {
          resolve: (cursors) => {
            subscriptions.push([...cursors]);
            return {
              accepted: true,
              streams: cursors.map((cursor) => ({
                stream: cursor.stream,
                latestSeq: cursor.processedSeq,
                earliestAvailableSeq: 1,
              })),
            };
          },
        },
      });
      const connection = new ProtocolConnection({
        transport: serverTransport,
        onMessage: (message) => session.receive(message),
      });
      binding.connection = connection;
      servers.push(connection);
      return clientTransport;
    },
  });
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  let liveCount = 0;
  const client = new ManagerWsClient(
    {
      onEvent: () => undefined,
      onConnectionChange: (state) => {
        if (state === "live") liveCount += 1;
      },
    },
    {
      transportFactory,
      storage,
      source: () => ({
        role: "ui",
        id: "ui_test",
        instanceId: "ui_instance",
      }),
    },
  );

  try {
    await client.setSelection("c", [
      { stream: "manager", processedSeq: 6 },
      { stream: "sandbox:c", processedSeq: 1 },
    ]);
    client.connect();
    await waitFor(() => liveCount === 1 && subscriptions.length >= 1);
    await Promise.all([
      client.setSelection("a", [
        { stream: "manager", processedSeq: 6 },
        { stream: "sandbox:a", processedSeq: 2 },
      ]),
      client.setSelection("b", [
        { stream: "manager", processedSeq: 6 },
        { stream: "sandbox:b", processedSeq: 3 },
      ]),
      client.setSelection("c", [
        { stream: "manager", processedSeq: 6 },
        { stream: "sandbox:c", processedSeq: 1 },
      ]),
    ]);
    assert.deepEqual(subscriptions.at(-1), [
      { stream: "manager", processedSeq: 6 },
      { stream: "sandbox:c", processedSeq: 1 },
    ]);
    const persisted = JSON.parse(
      values.get("nerve.protocol.v1.sandbox-manager-ui") ?? "{}",
    ) as { cursors: Array<{ stream: string; processedSeq: number }> };
    assert.equal(
      persisted.cursors.find((cursor) => cursor.stream === "sandbox:c")
        ?.processedSeq,
      1,
    );
  } finally {
    client.close();
    for (const server of servers) server.dispose();
  }
});

test("ManagerWsClient installs snapshot before applying replayed events", async () => {
  const [clientTransport, serverTransport] = createInMemoryTransportPair();
  const binding: { connection?: ProtocolConnection } = {};
  const serverMessages = createMessageFactory({
    source: { role: "sandbox_manager", id: "sandbox-manager" },
    target: {
      role: "ui",
      id: "ui_snapshot",
      instanceId: "ui_snapshot_instance",
    },
  });
  const event = {
    id: "evt_manager_6",
    seq: 6,
    type: "sandbox.lifecycle.changed",
    ts: "2026-01-01T00:00:00.000Z",
    data: {},
  };
  const serverSession = new ProtocolServerSession({
    acceptingPeer: { role: "sandbox_manager", id: "sandbox-manager" },
    allowedPeerRoles: ["ui"],
    createMessage: serverMessages,
    capabilities,
    limits,
    heartbeat: { intervalMs: 60_000, timeoutMs: 120_000 },
    sessionId: () => "session_snapshot_order",
    send: (message) => binding.connection?.send(message as ProtocolV1Message),
    readStream: (stream, fromSeq) => ({
      stream,
      latestSeq: 6,
      earliestAvailableSeq: 1,
      events: fromSeq <= 6 ? [event] : [],
    }),
    subscriptions: {
      resolve: (cursors) => ({
        accepted: true,
        streams: cursors.map((cursor) => ({
          stream: cursor.stream,
          latestSeq: 6,
          earliestAvailableSeq: 1,
        })),
      }),
    },
  });
  const serverConnection = new ProtocolConnection({
    transport: serverTransport,
    onMessage: (message) => serverSession.receive(message),
  });
  binding.connection = serverConnection;
  let releaseSnapshot!: () => void;
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  const order: string[] = [];
  const storageValues = new Map<string, string>();
  const client = new ManagerWsClient(
    {
      onConnectionChange: () => undefined,
      onSnapshotRecovery: async () => {
        order.push("snapshot-start");
        await snapshotGate;
        order.push("snapshot-installed");
        return [{ stream: "manager", processedSeq: 5 }];
      },
      onEvent: () => {
        order.push("replayed-event");
      },
    },
    {
      transportFactory: () => ({ connect: async () => clientTransport }),
      storage: {
        getItem: (key) => storageValues.get(key) ?? null,
        setItem: (key, value) => void storageValues.set(key, value),
        removeItem: (key) => void storageValues.delete(key),
      },
      source: () => ({
        role: "ui",
        id: "ui_snapshot",
        instanceId: "ui_snapshot_instance",
      }),
    },
  );
  try {
    await client.setSelection(undefined, [
      { stream: "manager", processedSeq: 9 },
    ]);
    client.connect();
    await waitFor(() => order.includes("snapshot-start"));
    assert.deepEqual(order, ["snapshot-start"]);
    releaseSnapshot();
    await waitFor(() => order.includes("replayed-event"));
    assert.deepEqual(order, [
      "snapshot-start",
      "snapshot-installed",
      "replayed-event",
    ]);
  } finally {
    client.close();
    serverConnection.dispose();
    serverSession.dispose();
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
