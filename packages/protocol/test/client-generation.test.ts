import type { ProtocolV1Message } from "@nervekit/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  ProtocolClientConnection,
  type ProtocolClientSession,
  ReconnectPolicy,
  createMessageFactory,
} from "../src/index.js";
import { ManualRuntime, ManualTransport } from "./test-runtime.js";

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
