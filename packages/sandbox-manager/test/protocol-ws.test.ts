import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { WebSocket } from "ws";
import { ManagerState } from "../src/app/manager-state.js";
import { createManagerServer } from "../src/app/server.js";
import { recordManagerLifecycleEvent } from "../src/events/manager-events.js";
import { createSandboxRecord } from "../src/routes/sandbox-routes.js";

const config = {
  version: 1,
  agent: {
    defaultModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
  },
  controller: {
    websocket: { url: "ws://unused" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
} as const;

const postgresUrl = process.env.NERVE_TEST_POSTGRES_URL;
const describeWithPostgres = postgresUrl ? describe : describe.skip;

describeWithPostgres("sandbox manager websocket protocol", async () => {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "nerve-manager-ws-"));
  const state = new ManagerState({
    host: "127.0.0.1",
    port: 0,
    allowRemoteBind: false,
    storageDir,
    backend: "docker",
    databaseUrl: postgresUrl,
    databaseSsl: false,
    volumeBackend: "local",
  });
  await state.init();
  const server = createManagerServer(state);
  await listen(server);
  const address = server.address();
  assert.equal(typeof address, "object");
  assert(address);
  const baseUrl = `ws://127.0.0.1:${address.port}`;
  const record = await createSandboxRecord(state, config);
  const sockets: WebSocket[] = [];
  after(async () => {
    for (const socket of sockets) socket.terminate();
    await closeServer(server);
    await rm(storageDir, { recursive: true, force: true });
  });

  it("rejects bad tokens", async () => {
    const ws = new WebSocket(
      `${baseUrl}/api/sandboxes/${record.sandboxId}/ws`,
      {
        headers: { authorization: "Bearer wrong" },
      },
    );
    sockets.push(ws);
    const error = await onceError(ws);
    assert.match(error.message, /401/);
  });

  it("accepts manager UI websocket sessions and streams lifecycle events", async () => {
    const ws = new WebSocket(`${baseUrl}/api/manager/ws`);
    sockets.push(ws);
    await onceOpen(ws);
    ws.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        role: "ui",
        capabilities: [
          "encoding.json",
          "event.batch",
          "event.replay",
          "event.ack.processed",
          "flow.backpressure",
          "sandbox.manager.ui.v1",
          "sandbox.manager.snapshots.v1",
          "sandbox.manager.lifecycle.v1",
        ],
        resume: { cursors: [] },
      }),
    );
    const welcome = await onceJson(ws);
    assert.equal(welcome.type, "welcome");
    assert.equal(
      (welcome.acceptedCapabilities as string[]).includes(
        "sandbox.manager.ui.v1",
      ),
      true,
    );
    await recordManagerLifecycleEvent(state, {
      type: "sandbox.lifecycle.changed",
      sandboxId: record.sandboxId,
      payload: {
        sandboxId: record.sandboxId,
        token: "ntok_should_not_leak",
        observedState: "running",
      },
    });
    const batch = await onceJson(ws);
    assert.equal(batch.type, "event.batch");
    assert.equal(JSON.stringify(batch).includes("ntok_should_not_leak"), false);
    ws.send(
      JSON.stringify({
        type: "replay.request",
        stream: "manager",
        afterSeq: 0,
        limit: 10,
      }),
    );
    const replay = await onceJson(ws);
    assert.equal(replay.type, "replay.response");
    assert.equal(replay.stream, "manager");
    assert.equal((replay.events as unknown[]).length >= 1, true);
  });

  it("protects manager UI websocket sessions when api auth is configured", async () => {
    const authedStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-ws-auth-"),
    );
    const authedState = new ManagerState({
      host: "127.0.0.1",
      port: 0,
      allowRemoteBind: false,
      storageDir: authedStorageDir,
      backend: "docker",
      databaseUrl: postgresUrl,
      databaseSsl: false,
      volumeBackend: "local",
      apiKey: "manager-secret-key",
    });
    await authedState.init();
    const authedServer = createManagerServer(authedState);
    await listen(authedServer);
    const authedAddress = authedServer.address();
    assert.equal(typeof authedAddress, "object");
    assert(authedAddress);
    try {
      const rejected = new WebSocket(
        `ws://127.0.0.1:${authedAddress.port}/api/manager/ws`,
      );
      const error = await onceError(rejected);
      assert.match(error.message, /401/);

      const accepted = new WebSocket(
        `ws://127.0.0.1:${authedAddress.port}/api/manager/ws`,
        {
          headers: { cookie: "nerve_sandbox_manager_auth=manager-secret-key" },
        },
      );
      sockets.push(accepted);
      await onceOpen(accepted);
      accepted.send(
        JSON.stringify({
          type: "hello",
          version: 1,
          role: "ui",
          capabilities: ["encoding.json", "sandbox.manager.ui.v1"],
          resume: { cursors: [] },
        }),
      );
      const welcome = await onceJson(accepted);
      assert.equal(welcome.type, "welcome");
      accepted.close();
      await onceClose(accepted);
    } finally {
      await closeServer(authedServer);
      await rm(authedStorageDir, { recursive: true, force: true });
    }
  });

  it("keeps replacement sandbox session connected when a stale socket closes", async () => {
    const staleRecord = await createSandboxRecord(state, config);
    const first = new WebSocket(
      `${baseUrl}/api/sandboxes/${staleRecord.sandboxId}/ws`,
      {
        headers: { authorization: `Bearer ${staleRecord.controller?.token}` },
      },
    );
    sockets.push(first);
    await onceOpen(first);
    first.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        role: "agent",
        sandboxId: staleRecord.sandboxId,
        instanceId: staleRecord.instanceId,
        capabilities: ["encoding.json", "sandbox.runtime.v1"],
      }),
    );
    const firstWelcome = await onceJson(first);
    assert.equal(firstWelcome.type, "welcome");
    assert.equal(typeof firstWelcome.sessionId, "string");
    const firstSessionId = firstWelcome.sessionId;
    let stored = await state.sessions.get(staleRecord.sandboxId);
    assert.equal(stored?.state, "connected");
    assert.equal(stored?.sessionId, firstSessionId);

    const firstClosed = onceClose(first);
    const second = new WebSocket(
      `${baseUrl}/api/sandboxes/${staleRecord.sandboxId}/ws`,
      {
        headers: { authorization: `Bearer ${staleRecord.controller?.token}` },
      },
    );
    sockets.push(second);
    await onceOpen(second);
    second.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        role: "agent",
        sandboxId: staleRecord.sandboxId,
        instanceId: staleRecord.instanceId,
        capabilities: ["encoding.json", "sandbox.runtime.v1"],
      }),
    );
    const secondWelcome = await onceJson(second);
    assert.equal(secondWelcome.type, "welcome");
    assert.equal(typeof secondWelcome.sessionId, "string");
    const secondSessionId = secondWelcome.sessionId;
    assert.notEqual(secondSessionId, firstSessionId);
    stored = await state.sessions.get(staleRecord.sandboxId);
    assert.equal(stored?.state, "connected");
    assert.equal(stored?.sessionId, secondSessionId);

    await firstClosed;
    await delay(50);
    stored = await state.sessions.get(staleRecord.sandboxId);
    assert.equal(stored?.state, "connected");
    assert.equal(stored?.sessionId, secondSessionId);

    second.close();
    await onceClose(second);
  });

  it("accepts hello, acks events, and forwards commands", async () => {
    const ws = new WebSocket(
      `${baseUrl}/api/sandboxes/${record.sandboxId}/ws`,
      {
        headers: { authorization: `Bearer ${record.controller?.token}` },
      },
    );
    sockets.push(ws);
    await onceOpen(ws);
    ws.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        role: "agent",
        sandboxId: record.sandboxId,
        instanceId: record.instanceId,
        capabilities: [
          "encoding.json",
          "event.batch",
          "event.replay",
          "event.ack.processed",
          "flow.backpressure",
          "sandbox.runtime.v1",
          "sandbox.events.v1",
          "sandbox.snapshots.v1",
          "unsupported.future",
        ],
      }),
    );
    const welcome = await onceJson(ws);
    assert.equal(welcome.type, "welcome");
    assert.deepEqual(
      (welcome.acceptedCapabilities as string[]).filter(
        (capability) =>
          capability.startsWith("sandbox.") || capability.startsWith("event."),
      ),
      [
        "event.batch",
        "event.replay",
        "event.ack.processed",
        "sandbox.runtime.v1",
        "sandbox.events.v1",
        "sandbox.snapshots.v1",
      ],
    );
    ws.send(
      JSON.stringify({
        type: "event.batch",
        batchId: "batch_1",
        stream: "sandbox",
        firstSeq: 1,
        lastSeq: 1,
        events: [
          {
            id: "evt_1",
            seq: 1,
            ts: new Date().toISOString(),
            type: "sandbox.ready",
            durability: "durable",
            data: {
              instanceId: record.instanceId,
              status: "ready",
              readyAt: new Date().toISOString(),
              recovered: false,
              daemonStatus: "ready",
              cursor: { streams: [{ stream: "sandbox", processedSeq: 0 }] },
            },
          },
        ],
      }),
    );
    const ack = await onceJson(ws);
    assert.equal(ack.type, "ack");
    assert.equal(ack.processedSeq, 1);
    ws.send(
      JSON.stringify({
        type: "event.batch",
        batchId: "batch_2",
        stream: "sandbox",
        firstSeq: 2,
        lastSeq: 3,
        events: [
          {
            id: "evt_2",
            seq: 2,
            ts: new Date().toISOString(),
            type: "run.delta",
            durability: "transient",
            data: {
              instanceId: record.instanceId,
              conversationId: "conv_1",
              agentId: "agent_main",
              runId: "run_1",
              deltaId: "delta_1",
              role: "assistant",
              text: "secret sk-test-token",
            },
          },
          {
            id: "evt_3",
            seq: 3,
            ts: new Date().toISOString(),
            type: "run.completed",
            durability: "durable",
            data: {
              instanceId: record.instanceId,
              conversationId: "conv_1",
              agentId: "agent_main",
              runId: "run_1",
              status: "completed",
              completedAt: new Date().toISOString(),
            },
          },
        ],
      }),
    );
    const matrixAck = await onceJson(ws);
    assert.equal(matrixAck.type, "ack");
    assert.equal(matrixAck.processedSeq, 3);
    assert.equal((await state.events.list(record.sandboxId)).length, 3);
    ws.send(
      JSON.stringify({
        type: "replay.request",
        stream: "sandbox",
        afterSeq: 1,
        limit: 10,
      }),
    );
    const replay = await onceJson(ws);
    assert.equal(replay.type, "replay.response");
    assert.deepEqual(
      (replay.events as Array<{ type: string; seq: number }>).map((event) => [
        event.seq,
        event.type,
      ]),
      [[3, "run.completed"]],
    );
  });
});

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function onceOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function onceError(ws: WebSocket): Promise<Error> {
  return new Promise((resolve) => ws.once("error", resolve));
}

function onceJson(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(String(data)))),
  );
}

function onceClose(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => ws.once("close", () => resolve()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
