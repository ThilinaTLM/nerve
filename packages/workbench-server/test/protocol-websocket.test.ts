import assert from "node:assert/strict";
import type { Server } from "node:http";
import { afterEach, test } from "node:test";
import { serve } from "@hono/node-server";
import type { ProtocolV1Message } from "@nervekit/contracts";
import {
  ProtocolCodec,
  ProtocolClientConnection,
  ProtocolClientSession,
  createMessageFactory,
  nodeWebSocketTransportFactory,
} from "@nervekit/protocol";
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

test("real adapter delivers live events published after a head subscription", async () => {
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
  const head = (await host.state.events.bounds("workspace")).latestSeq;
  const updated = await subscribeWorkspace(
    peer,
    messages,
    welcome.data.sessionId,
    head,
  );
  assert.equal(updated.data.streams[0]?.mode, "live");

  const event = await host.state.events.publish(
    "project.created",
    projectCreatedData("proj_live"),
  );
  const batch = await peer.next("event.batch");
  assert.equal(batch.data.reason, "live");
  assert.equal(
    batch.data.events.some((candidate) => candidate.id === event.id),
    true,
  );
  peer.socket.close();
});

test("real ProtocolClientSession applies live events after app-style subscribe", async () => {
  const host = await fixture();
  const applied: Array<{ stream: string; seq: number; type: string }> = [];
  const cursors = new Map<string, number>([["workspace", 0]]);
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const messages = clientMessages(host.state.daemonId);
  const connection = new ProtocolClientConnection({
    transport: nodeWebSocketTransportFactory(
      () =>
        new WebSocket(host.wsUrl, {
          headers: { authorization: `Bearer ${host.token}` },
        }) as unknown as import("@nervekit/protocol").WebSocketLike,
    ),
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: messages,
        capabilities: [
          "encoding.json",
          "event.batch",
          "event.notify",
          "stream.subscription.v1",
          "snapshot.workspace",
        ],
        requiredCapabilities: [
          "encoding.json",
          "event.batch",
          "event.notify",
          "stream.subscription.v1",
          "snapshot.workspace",
        ],
        cursors: () =>
          [...cursors].map(([stream, processedSeq]) => ({
            stream,
            processedSeq,
          })),
        send,
        onDisconnect,
        onReady: () => resolveReady(),
        applyEvent: async (stream, event) => {
          applied.push({ stream, seq: event.seq, type: event.type });
          cursors.set(stream, event.seq);
        },
      }),
  });
  cleanups.push(async () => connection.close());
  await connection.start();
  await ready;

  await connection.session.subscribe(
    [...cursors].map(([stream, processedSeq]) => ({ stream, processedSeq })),
  );
  const event = await host.state.events.publish(
    "project.created",
    projectCreatedData("proj_client_live"),
  );
  const deadline = Date.now() + 5_000;
  while (
    Date.now() < deadline &&
    !applied.some((entry) => entry.seq === event.seq)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(
    applied.some(
      (entry) =>
        entry.stream === "workspace" &&
        entry.seq === event.seq &&
        entry.type === "project.created",
    ),
    true,
    `live event was not applied; applied=${JSON.stringify(applied)}`,
  );
});

test("real client applies live conversation events on a two-stream subscription", async () => {
  const host = await fixture();
  const project = await host.state.registry.createProject({
    dir: `/tmp/proj-live-conv-${crypto.randomUUID()}`,
  });
  const conversation = await host.state.registry.createConversation({
    projectId: project.id,
  });
  const stream = `conv/${conversation.id}`;
  const applied: Array<{ stream: string; seq: number; type: string }> = [];
  const cursors = new Map<string, number>([
    ["workspace", (await host.state.events.bounds("workspace")).latestSeq],
    [stream, (await host.state.events.bounds(stream)).latestSeq],
  ]);
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const messages = clientMessages(host.state.daemonId);
  const connection = new ProtocolClientConnection({
    transport: nodeWebSocketTransportFactory(
      () =>
        new WebSocket(host.wsUrl, {
          headers: { authorization: `Bearer ${host.token}` },
        }) as unknown as import("@nervekit/protocol").WebSocketLike,
    ),
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: messages,
        capabilities: ["encoding.json", "event.batch", "event.notify"],
        cursors: () =>
          [...cursors].map(([name, processedSeq]) => ({
            stream: name,
            processedSeq,
          })),
        send,
        onDisconnect,
        onReady: () => resolveReady(),
        applyEvent: async (name, event) => {
          applied.push({ stream: name, seq: event.seq, type: event.type });
          cursors.set(name, event.seq);
        },
      }),
  });
  cleanups.push(async () => connection.close());
  await connection.start();
  await ready;
  await connection.session.subscribe(
    [...cursors].map(([name, processedSeq]) => ({
      stream: name,
      processedSeq,
    })),
  );

  const event = await host.state.events.publish(
    "conversation.live.turn.started",
    {
      projectId: project.id,
      conversationId: conversation.id,
      agentId: "agent_live",
      runId: "run_live",
      turnId: "turn_live",
      ordinal: 0,
    },
  );
  const deadline = Date.now() + 5_000;
  while (
    Date.now() < deadline &&
    !applied.some((entry) => entry.stream === stream)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(
    applied.some((entry) => entry.stream === stream && entry.seq === event.seq),
    true,
    `live conversation event was not applied; applied=${JSON.stringify(applied)}`,
  );
});

test("a stale conversation stream degrades per-stream without silencing workspace", async () => {
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
  const head = (await host.state.events.bounds("workspace")).latestSeq;
  peer.socket.send(
    codec.encode(
      messages("stream.subscription.set", {
        sessionId: welcome.data.sessionId,
        subscriptionId: `sub_${crypto.randomUUID()}`,
        streams: [
          { stream: "workspace", processedSeq: head },
          { stream: "conv/conv_deleted_long_ago", processedSeq: 0 },
        ],
      }) as ProtocolV1Message,
    ),
  );
  const updated = await peer.next("stream.subscription.updated");
  assert.equal(
    updated.data.accepted,
    true,
    `subscription rejected: ${JSON.stringify(updated.data)}`,
  );
  const modes = new Map(
    updated.data.streams.map((stream) => [stream.stream, stream.mode]),
  );
  assert.equal(modes.get("workspace"), "live");
  assert.equal(modes.get("conv/conv_deleted_long_ago"), "unavailable");

  const event = await host.state.events.publish(
    "project.created",
    projectCreatedData("proj_degraded"),
  );
  const batch = await peer.next("event.batch");
  assert.equal(batch.data.stream, "workspace");
  assert.equal(
    batch.data.events.some((candidate) => candidate.id === event.id),
    true,
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
