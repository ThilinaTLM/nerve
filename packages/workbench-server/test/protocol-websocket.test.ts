import assert from "node:assert/strict";
import type { Server } from "node:http";
import { afterEach, test } from "node:test";
import { serve } from "@hono/node-server";
import type { ProtocolV1Message } from "@nervekit/contracts";
import { ProtocolCodec, createMessageFactory } from "@nervekit/protocol";
import WebSocket, { WebSocketServer } from "ws";
import { createOrchestratorState } from "../src/app/orchestrator-state.js";
import { createApp } from "../src/app/server.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";
import { PROTOCOL_CAPABILITIES } from "../src/protocol/constants.js";
import { orchestratorSource } from "../src/protocol/messages.js";
import {
  installProtocolWebSocketUpgrade,
  type LocalProtocolSession,
} from "../src/protocol/protocol-websocket.js";
import { tempHome } from "./helpers/server-routes.js";

const codec = new ProtocolCodec();
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture() {
  const storage = await initializeStorage(await tempHome("nerve-protocol-ws-"));
  const state = createOrchestratorState(storage, "127.0.0.1", 0);
  await state.logger.hydrate();
  await state.events.hydrate();
  await state.registry.hydrate();
  const server = await new Promise<Server>((resolve) => {
    const started = serve(
      { fetch: createApp(state).fetch, hostname: "127.0.0.1", port: 0 },
      () => resolve(started),
    );
  });
  const address = server.address();
  assert(address && typeof address === "object");
  state.port = address.port;
  const webSockets = new WebSocketServer({ noServer: true });
  const sessions = installProtocolWebSocketUpgrade(
    server,
    webSockets,
    state,
    storage.localToken,
  );
  cleanups.push(async () => {
    await Promise.all(
      [...sessions].map((session) => session.shutdown("test cleanup")),
    );
    for (const client of webSockets.clients) client.terminate();
    await new Promise<void>((resolve) => webSockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    state.index.close();
  });
  return {
    state,
    sessions,
    token: storage.localToken,
    httpUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
  };
}

async function open(url: string, token: string) {
  const socket = new WebSocket(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const messages: ProtocolV1Message[] = [];
  const waiters = new Set<() => void>();
  socket.on("message", (data) => {
    messages.push(codec.decode(data.toString()));
    for (const wake of waiters) wake();
  });
  const next = async (kind: ProtocolV1Message["kind"]) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const index = messages.findIndex((message) => message.kind === kind);
      if (index >= 0) return messages.splice(index, 1)[0] as ProtocolV1Message;
      await new Promise<void>((resolve) => {
        const wake = () => {
          waiters.delete(wake);
          resolve();
        };
        waiters.add(wake);
        setTimeout(wake, 25);
      });
    }
    throw new Error(
      `Timed out waiting for ${kind}; received=${messages.map((message) => message.kind).join(",")}; state=${socket.readyState}`,
    );
  };
  return { socket, messages, next };
}

function clientMessages(daemonId: string) {
  return createMessageFactory({
    source: { role: "ui", id: "ui_adapter_test" },
    target: orchestratorSource(daemonId),
  });
}

async function handshake(
  peer: Awaited<ReturnType<typeof open>>,
  messages: ReturnType<typeof clientMessages>,
) {
  peer.socket.send(
    codec.encode(
      messages("hello", {
        requestedVersion: 1,
        capabilities: [...PROTOCOL_CAPABILITIES],
        requiredCapabilities: ["snapshot.workspace"],
        encodings: ["json"],
      }) as ProtocolV1Message,
    ),
  );
  const welcome = await peer.next("welcome");
  assert.equal(welcome.data.acceptingPeer.role, "workbench_server");
  assert(welcome.data.capabilities.includes("snapshot.workspace"));
  return welcome;
}

async function subscribeWorkspace(
  peer: Awaited<ReturnType<typeof open>>,
  messages: ReturnType<typeof clientMessages>,
  sessionId: string,
  processedSeq = 0,
) {
  peer.socket.send(
    codec.encode(
      messages("stream.subscription.set", {
        sessionId,
        subscriptionId: `sub_${crypto.randomUUID()}`,
        streams: [{ stream: "workspace", processedSeq }],
      }) as ProtocolV1Message,
    ),
  );
  return peer.next("stream.subscription.updated");
}

function projectCreatedData(id: string) {
  const now = new Date().toISOString();
  return {
    project: {
      id,
      name: id,
      dir: `/tmp/${id}`,
      createdAt: now,
      updatedAt: now,
    },
  };
}

test("real adapter gates live/RPC until ready and shares canonical HTTP/WS dispatch", async () => {
  const host = await fixture();
  const peer = await open(host.wsUrl, host.token);
  const messages = clientMessages(host.state.daemonId);
  const welcome = await handshake(peer, messages);
  assert.equal(host.sessions.size, 1);

  const event = await host.state.events.publish(
    "project.created",
    projectCreatedData("proj_handshake"),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    peer.messages.some(
      (message) =>
        message.kind === "event.batch" || message.kind === "response",
    ),
    false,
  );

  peer.socket.send(
    codec.encode(
      messages("ready", {
        sessionId: welcome.data.sessionId,
      }) as ProtocolV1Message,
    ),
  );
  const updated = await subscribeWorkspace(
    peer,
    messages,
    welcome.data.sessionId,
  );
  assert.equal(updated.data.streams[0]?.mode, "replay");
  const batch = await peer.next("event.batch");
  assert.equal(
    batch.data.events.some((candidate) => candidate.id === event.id),
    true,
  );
  const request = messages("request", {
    method: "snapshot.workspace.get",
    params: {},
  });
  peer.socket.send(codec.encode(request as ProtocolV1Message));
  const response = await peer.next("response");
  assert.equal(response.replyTo, request.id);

  const httpRequest = messages("request", {
    method: "snapshot.workspace.get",
    params: {},
  });
  const http = await fetch(`${host.httpUrl}/api/protocol/v1`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${host.token}`,
      "content-type": "application/vnd.nerve.protocol.v1+json",
    },
    body: JSON.stringify(httpRequest),
  });
  assert.equal(http.status, 200);
  const httpResponse = codec.decode(await http.text());
  assert.equal(httpResponse.kind, "response");
  assert.deepEqual(
    (httpResponse.data.result as { snapshot: unknown }).snapshot,
    (response.data.result as { snapshot: unknown }).snapshot,
  );

  peer.socket.close();
  await new Promise<void>((resolve) =>
    peer.socket.once("close", () => resolve()),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.sessions.size, 0);
});

test("real adapter replays exclusively through stream subscriptions", async () => {
  const host = await fixture();
  const event = await host.state.events.publish(
    "project.created",
    projectCreatedData("proj_replay"),
  );
  const peer = await open(host.wsUrl, host.token);
  const messages = clientMessages(host.state.daemonId);
  const welcome = await handshake(peer, messages);
  peer.socket.send(
    codec.encode(
      messages("ready", {
        sessionId: welcome.data.sessionId,
      }) as ProtocolV1Message,
    ),
  );
  const updated = await subscribeWorkspace(
    peer,
    messages,
    welcome.data.sessionId,
  );
  assert.equal(updated.data.streams[0]?.mode, "replay");
  const batch = await peer.next("event.batch");
  assert.equal(
    batch.data.events.filter((candidate) => candidate.id === event.id).length,
    1,
  );
  peer.socket.close();
});

test("invalid frames close and dispose the real socket binding", async () => {
  const host = await fixture();
  const peer = await open(host.wsUrl, host.token);
  peer.socket.send("not-json");
  const close = await new Promise<{ code: number; reason: string }>((resolve) =>
    peer.socket.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    ),
  );
  assert.equal(close.code, 1002);
  assert.equal(host.sessions.size, 0);
  await host.state.events.publish(
    "project.created",
    projectCreatedData("proj_after_close"),
  );
});

test("graceful adapter shutdown sends goodbye and closes cleanly", async () => {
  const host = await fixture();
  const peer = await open(host.wsUrl, host.token);
  const messages = clientMessages(host.state.daemonId);
  const welcome = await handshake(peer, messages);
  peer.socket.send(
    codec.encode(
      messages("ready", {
        sessionId: welcome.data.sessionId,
      }) as ProtocolV1Message,
    ),
  );
  const binding = [...host.sessions][0] as LocalProtocolSession;
  const closed = new Promise<void>((resolve) =>
    peer.socket.once("close", () => resolve()),
  );
  await binding.shutdown("test shutdown");
  const goodbye = await peer.next("goodbye");
  assert.equal(goodbye.data.reason, "server_shutdown");
  await closed;
  assert.equal(host.sessions.size, 0);
});
