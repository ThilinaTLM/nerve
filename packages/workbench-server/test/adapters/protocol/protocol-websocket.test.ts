import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import { serve } from "@hono/node-server";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  type ProtocolV1Message,
} from "@nervekit/contracts/wire";
import { allOperationDefinitions } from "@nervekit/contracts/operations";
import { ProtocolCodec, createMessageFactory } from "@nervekit/protocol";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { afterEach, test } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { createApp } from "../../../src/app/server.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { orchestratorSource } from "../../../src/adapters/protocol/messages.js";
import {
  installProtocolWebSocketUpgrade,
  type LocalProtocolSession,
} from "../../../src/adapters/protocol/protocol-websocket.js";
import { tempHome } from "../../helpers/server-routes.js";

const codec = new ProtocolCodec();
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 2_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} did not finish within ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function closeWithTimeout(
  close: (done: (error?: Error) => void) => void,
  label: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} did not close within 2 seconds`)),
      2_000,
    );
    close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}

async function fixture() {
  const storage = await initializeStorage(await tempHome("nerve-protocol-ws-"));
  const runtimeFixture = createRuntimeFixture(storage, "127.0.0.1", 0);
  const state = runtimeFixture.runtime;
  await state.logger.hydrate();
  await runtimeFixture.lifecycle.hydrate();
  const server = await new Promise<Server>((resolve) => {
    const started = serve(
      { fetch: createApp(state).fetch, hostname: "127.0.0.1", port: 0 },
      () => resolve(started),
    );
  });
  const address = server.address();
  assert(address && typeof address === "object");
  state.port = address.port;
  state.adapterContexts.websocket.port = address.port;
  const webSockets = new WebSocketServer({ noServer: true });
  const sessions = installProtocolWebSocketUpgrade(
    server,
    webSockets,
    state.adapterContexts.websocket,
    storage.localToken,
  );
  cleanups.push(async () => {
    const results: PromiseSettledResult<unknown>[] = [];
    results.push(
      ...(await Promise.allSettled(
        [...sessions].map((session) =>
          withTimeout(
            session.shutdown("test cleanup"),
            "Protocol session shutdown",
          ),
        ),
      )),
    );
    for (const client of webSockets.clients) client.terminate();
    results.push(
      ...(await Promise.allSettled([
        closeWithTimeout(
          (done) => webSockets.close(() => done()),
          "WebSocket server",
        ),
        closeWithTimeout(
          (done) => server.close((error) => done(error)),
          "HTTP server",
        ),
      ])),
    );
    await shutdownServerRuntime(state);
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "Protocol fixture cleanup failed",
      );
    }
  });
  return {
    state,
    services: runtimeFixture.services,
    sessions,
    token: storage.localToken,
    httpUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws/workbench`,
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
        capabilities: [
          "encoding.json",
          "event.notify",
          STREAM_SUBSCRIPTION_CAPABILITY,
          ...allOperationDefinitions()
            .map((definition) => definition.requiredCapability)
            .filter((value): value is string => Boolean(value)),
        ],
        requiredCapabilities: [STREAM_SUBSCRIPTION_CAPABILITY],
        encodings: ["json"],
      }) as ProtocolV1Message,
    ),
  );
  const welcome = await peer.next("welcome");
  assert.equal(welcome.data.acceptingPeer.role, "workbench_server");
  assert(welcome.data.capabilities.includes(STREAM_SUBSCRIPTION_CAPABILITY));
  return welcome;
}

async function subscribeConversation(
  peer: Awaited<ReturnType<typeof open>>,
  messages: ReturnType<typeof clientMessages>,
  sessionId: string,
  stream: string,
  processedSeq = 0,
) {
  peer.socket.send(
    codec.encode(
      messages("stream.subscription.set", {
        sessionId,
        subscriptionId: `sub_${crypto.randomUUID()}`,
        streams: [{ stream, processedSeq }],
      }) as ProtocolV1Message,
    ),
  );
  return peer.next("stream.subscription.updated");
}

test("workbench adapter gates notices until ready and shares HTTP/WS dispatch", async () => {
  const host = await fixture();
  const peer = await open(host.wsUrl, host.token);
  const messages = clientMessages(host.state.daemonId);
  const welcome = await handshake(peer, messages);
  await host.state.events.publish("daemon.stopped", {
    daemonId: host.state.daemonId,
    signal: "SIGTERM",
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    peer.messages.some((message) => message.kind === "event.notify"),
    false,
  );
  peer.socket.send(
    codec.encode(
      messages("ready", {
        sessionId: welcome.data.sessionId,
      }) as ProtocolV1Message,
    ),
  );
  const request = messages("request", {
    method: "providerCatalog.get",
    params: {},
  });
  peer.socket.send(codec.encode(request as ProtocolV1Message));
  const response = await peer.next("response");
  assert.equal(response.replyTo, request.id);
  await host.state.events.publish("daemon.stopped", {
    daemonId: host.state.daemonId,
    signal: "SIGTERM",
  });
  const notice = await peer.next("event.notify");
  assert.equal(notice.data.events[0]?.type, "daemon.stopped");
  const headers = {
    authorization: `Bearer ${host.token}`,
    "content-type": "application/vnd.nerve.protocol.v1+json",
  };
  const http = await fetch(`${host.httpUrl}/api/protocol/v1`, {
    method: "POST",
    headers,
    body: JSON.stringify(
      messages("request", { method: "providerCatalog.get", params: {} }),
    ),
  });
  assert.equal(http.status, 200);
  const httpResponse = codec.decode(await http.text());
  assert.equal(httpResponse.kind, "response");
  assert.deepEqual(httpResponse.data.result, response.data.result);
  const monitorHttp = await fetch(`${host.httpUrl}/api/protocol/v1`, {
    method: "POST",
    headers,
    body: JSON.stringify(
      messages("request", {
        method: "filesystem.project.monitor.sync",
        params: { projectId: "proj_session_required", directories: [""] },
      }),
    ),
  });
  assert.equal(monitorHttp.status, 400);
  const monitorError = codec.decode(await monitorHttp.text());
  assert.equal(monitorError.kind, "error");
  assert.equal(monitorError.data.code, "SESSION_REQUIRED");
  const binding = [...host.sessions][0];
  peer.socket.close();
  await binding.closed;
  assert.equal(host.sessions.size, 0);
});

test("conversation adapter replays durable events from the requested cursor", async () => {
  const host = await fixture();
  const core = host.services.conversationCore;
  const project = core.projects.create({
    name: "Replay fixture",
    directory: await tempHome("nerve-replay-project-"),
  });
  const snapshot = await core.createConversation({
    id: "conv_replay",
    projectId: project.id,
    title: "Replay fixture",
    config: {
      model: { provider: "nerve-faux", modelId: "faux-fast" },
      reasoningLevel: "off",
      systemPrompt: null,
      mode: "coding",
      permissionRuleSetId: "read_only",
      workingDirectory: project.directory,
    },
  });
  for (const index of [1, 2])
    host.services.coreStorage.events.append({
      id: `evt_replay_${index}`,
      conversationId: snapshot.conversation.id,
      type: "user_message",
      llmRepresentation: "user",
      turnId: null,
      inputId: null,
      createdAt: new Date().toISOString(),
      payload: {
        text: `Prompt ${index}`,
        originalText: `Prompt ${index}`,
        source: "user",
        senderConversationId: null,
        commandPreparation: null,
      },
    });
  const peer = await open(
    host.wsUrl.replace("/workbench", "/conversations"),
    host.token,
  );
  const messages = clientMessages(host.state.daemonId);
  const welcome = await handshake(peer, messages);
  peer.socket.send(
    codec.encode(
      messages("ready", {
        sessionId: welcome.data.sessionId,
      }) as ProtocolV1Message,
    ),
  );
  const updated = await subscribeConversation(
    peer,
    messages,
    welcome.data.sessionId,
    "conv/conv_replay",
    1,
  );
  assert.equal(updated.data.streams[0]?.mode, "replay");
  const batch = await peer.next("event.batch");
  assert.deepEqual(
    batch.data.events.map((event) => event.seq),
    [2],
  );
  assert.equal(batch.data.events[0]?.type, "conversation.event");
  assert.equal(batch.data.events[0]?.data.sequence, 2);
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
  await host.state.events.publish("daemon.stopped", {
    daemonId: host.state.daemonId,
    signal: "SIGTERM",
  });
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
