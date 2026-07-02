import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { WebSocket } from "ws";
import { ManagerState } from "../src/app/manager-state.js";
import { createManagerServer } from "../src/app/server.js";
import { createSandboxRecord } from "../src/routes/sandbox-routes.js";

const config = {
  version: 1,
  agent: { mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" } },
  controller: {
    websocket: { url: "ws://unused" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
} as const;

describe("sandbox manager websocket protocol", async () => {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "nerve-manager-ws-"));
  const state = new ManagerState({
    host: "127.0.0.1",
    port: 0,
    allowRemoteBind: false,
    storageDir,
    backend: "docker",
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
          "sandbox.commands.v1",
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
        "sandbox.commands.v1",
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
    assert.equal((await state.events.list(record.sandboxId)).length, 1);

    const command = fetch(
      `http://127.0.0.1:${address.port}/api/sandboxes/${record.sandboxId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({ method: "sandbox.status.get", params: {} }),
      },
    ).then(async (response) => response.json() as Promise<{ data: unknown }>);
    const request = await onceJson(ws);
    assert.equal(request.type, "request");
    ws.send(
      JSON.stringify({
        type: "response",
        id: request.id,
        result: { instanceId: record.instanceId, status: "ready" },
      }),
    );
    const response = await command;
    assert.deepEqual(response.data, {
      instanceId: record.instanceId,
      status: "ready",
    });
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
