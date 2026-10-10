import type { ProtocolV1Message } from "@nervekit/contracts/wire";
import assert from "node:assert/strict";
import test from "node:test";
import { createMessageFactory } from "../../src/index.js";
import {
  ProtocolClientConnection,
  ProtocolClientSession,
  ReconnectPolicy,
} from "../../src/client.js";
import { ManualRuntime, ManualTransport } from "../test-runtime.js";

const messages = createMessageFactory({
  source: { role: "workbench_server", id: "server_generation" },
  target: { role: "ui", id: "ui_generation" },
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("client waits for an old in-flight generation before reconnecting", async () => {
  const runtime = new ManualRuntime();
  const transports: ManualTransport[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let receives = 0;
  const session = {
    state: "awaiting_welcome",
    start: async () => undefined,
    receive: async () => {
      receives += 1;
      await gate;
    },
    disconnect: () => undefined,
    close: async () => undefined,
    request: () => Promise.reject(new Error("unused")),
  } as unknown as ProtocolClientSession;
  const connection = new ProtocolClientConnection({
    transport: {
      connect: () => {
        const transport = new ManualTransport();
        transports.push(transport);
        return transport;
      },
    },
    timers: runtime,
    reconnect: new ReconnectPolicy({
      initialDelayMs: 0,
      maximumDelayMs: 0,
      jitter: 0,
      maximumAttempts: 2,
    }),
    createSession: () => session,
  });
  await connection.start();
  void transports[0]?.emit(
    messages("heartbeat", {
      sessionId: "session_generation",
      sentAt: new Date().toISOString(),
    }) as ProtocolV1Message,
  );
  await tick();
  transports[0]?.remoteClose(1006, "network lost");
  runtime.advance(1);
  await tick();
  assert.equal(receives, 1);
  assert.equal(transports.length, 1);

  release();
  await tick();
  await tick();
  runtime.advance(1);
  await tick();
  assert.equal(transports.length, 2);
  await connection.close();
});

test("client codec accepts messages above 1 MiB after negotiating a 4 MiB limit", async () => {
  const runtime = new ManualRuntime();
  const transport = new ManualTransport();
  let receiveFrame!: (frame: string) => void;
  transport.onMessage = (listener) => {
    receiveFrame = listener;
    return () => undefined;
  };
  const notices: string[] = [];
  const errors: unknown[] = [];
  const clientMessages = createMessageFactory({
    source: { role: "ui", id: "ui_generation" },
    target: { role: "workbench_server", id: "server_generation" },
  });
  const connection = new ProtocolClientConnection({
    transport: { connect: () => transport },
    timers: runtime,
    onError: (error) => {
      errors.push(error);
    },
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: clientMessages,
        capabilities: ["encoding.json", "event.notify"],
        timers: runtime,
        send,
        onDisconnect,
        onNotify: (events) => {
          notices.push(...events.map((event) => event.id));
        },
      }),
  });
  try {
    await connection.start();
    receiveFrame(
      JSON.stringify(
        messages("welcome", {
          sessionId: "session_generation",
          acceptingPeer: { role: "workbench_server", id: "server_generation" },
          acceptedVersion: 1,
          capabilities: [
            "encoding.json",
            "event.notify",
            "stream.subscription.v1",
          ],
          encoding: "json",
          limits: {
            maxMessageBytes: 4 * 1024 * 1024,
            maxBatchEvents: 100,
            maxBatchBytes: 512 * 1024,
          },
          heartbeat: { intervalMs: 60_000, timeoutMs: 120_000 },
        }),
      ),
    );
    await tick();
    assert.equal(connection.state, "ready");
    receiveFrame(
      JSON.stringify(
        messages("event.notify", {
          events: [
            {
              id: "evt_large",
              ts: "2026-01-01T00:00:00.000Z",
              type: "capabilities.changed",
              data: { projectId: "x".repeat(2_047_842) },
            },
          ],
        }),
      ),
    );
    await tick();
    assert.deepEqual(notices, ["evt_large"]);
    assert.deepEqual(errors, []);
    assert.equal(connection.state, "ready");
  } finally {
    await connection.close();
  }
});
