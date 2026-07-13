#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { createRequire } from "node:module";
import os from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEventBatch,
  createMessageFactory,
  nodeWebSocketTransportFactory,
  protocolRequest,
  ProtocolClientConnection,
  ProtocolClientSession,
  ReconnectPolicy,
  RpcDispatcher,
} from "../packages/protocol/dist/index.js";
import { ManagerState } from "../packages/sandbox-manager/dist/app/manager-state.js";
import { createManagerServer } from "../packages/sandbox-manager/dist/app/server.js";
import { createSandboxRecord } from "../packages/sandbox-manager/dist/routes/sandbox-routes.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(
  new URL("../packages/protocol/package.json", import.meta.url),
);
const { WebSocket } = require("ws");
const storageDir = await mkdtemp(join(os.tmpdir(), "nerve-manager-smoke-"));
const managerPort = await availablePort();
const postgres = await startPostgres();
const state = new ManagerState({
  host: "127.0.0.1",
  port: managerPort,
  allowRemoteBind: false,
  storageDir,
  backend: "docker",
  databaseUrl: postgres.url,
  databaseSsl: false,
  volumeBackend: "local",
  serveWebUi: true,
  logLevel: "error",
  logBufferSize: 100,
});
let server;
let agent;

try {
  console.log("Initializing built sandbox manager state...");
  try {
    await state.init();
  } catch (error) {
    postgres.diagnose();
    throw error;
  }
  server = createManagerServer(state);
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(managerPort, "127.0.0.1", resolveListen);
  });
  const origin = `http://127.0.0.1:${managerPort}`;
  const health = await fetch(`${origin}/health`);
  assert.equal(health.ok, true);
  const html = await (await fetch(`${origin}/`)).text();
  const assetPath = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
  assert(assetPath, "manager web index must reference an asset");
  assert.equal((await fetch(`${origin}${assetPath}`)).ok, true);

  const config = {
    version: 1,
    agent: {
      defaultModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
    },
    controller: {
      websocket: { url: "ws://placeholder" },
      auth: { type: "api_key", apiKey: { env: "TOKEN" } },
    },
  };
  console.log("Creating isolated sandbox fixture...");
  const record = await createSandboxRecord(state, config, {
    sandboxId: `sbx_smoke_${Date.now()}`,
    name: "release-smoke",
    image: "nerve-sandbox-agent:dev",
    backend: "docker",
  });
  const stream = `sandbox:${record.sandboxId}`;
  const persistedBeforeConnect = await state.events.list(record.sandboxId);
  console.log(
    `Persisted sandbox events before connect: ${persistedBeforeConnect.length}`,
  );
  console.log(`Sandbox controller URL: ${record.controller.url}`);
  let forwarded;
  let acknowledged = 0;
  console.log("Connecting canonical sandbox agent session...");
  agent = createAgent(
    record,
    0,
    (request) => (forwarded = request),
    (seq) => (acknowledged = seq),
  );
  await agent.start();
  await waitUntil(() => agent.state === "ready", 10_000, "manager-agent ready");

  const now = new Date().toISOString();
  await agent.session.publishEventBatch(
    buildEventBatch(
      [
        {
          id: "evt_release_smoke",
          seq: 1,
          type: "sandbox.startup.stage.started",
          ts: now,
          durability: "durable",
          data: {
            sandboxId: record.sandboxId,
            instanceId: record.instanceId,
            stage: "runtime",
            attempt: 1,
            startedAt: now,
          },
        },
      ],
      { stream, reason: "live", previousDurableSeq: 0 },
    ),
  );
  await waitUntil(
    () => acknowledged === 1,
    10_000,
    "sandbox event processed ACK",
  );

  console.log("Forwarding targeted task.list operation...");
  const rpc = await protocolRequest(
    "task.list",
    {},
    {
      apiPath: `${origin}/api/protocol/v1`,
      source: {
        role: "ui",
        id: "sandbox-smoke-ui",
        instanceId: "sandbox-smoke-tab",
      },
      target: { role: "sandbox_agent", id: record.sandboxId },
    },
  );
  assert.deepEqual(rpc.result, { tasks: [] });
  assert.equal(forwarded?.data.method, "task.list");
  assert.deepEqual(forwarded?.data.params, {});
  assert.equal(forwarded?.data.idempotencyKey, undefined);

  const recovery = await protocolRequest(
    "sandbox.manager.recovery.get",
    { sandboxId: record.sandboxId },
    {
      apiPath: `${origin}/api/protocol/v1`,
      source: {
        role: "ui",
        id: "sandbox-smoke-ui",
        instanceId: "sandbox-smoke-tab",
      },
      target: { role: "sandbox_manager", id: "sandbox-manager" },
    },
  );
  assert.equal(
    recovery.result.cursors.find((cursor) => cursor.stream === stream)
      ?.processedSeq,
    1,
  );

  console.log("Reconnecting from exact sandbox cursor...");
  await agent.close();
  let resumedFromExactCursor = false;
  agent = createAgent(
    record,
    1,
    () => undefined,
    (seq) => (acknowledged = seq),
    (welcome) => {
      resumedFromExactCursor =
        welcome.resume.accepted && welcome.resume.mode === "live";
    },
  );
  await agent.start();
  await waitUntil(
    () => agent.state === "ready" && resumedFromExactCursor,
    10_000,
    "manager-agent exact cursor resume",
  );

  console.log("Sandbox manager UI and manager-agent release smoke passed.");
} finally {
  await agent?.close().catch(() => undefined);
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  await state.pool.end().catch(() => undefined);
  await rm(storageDir, { recursive: true, force: true });
  await postgres.stop();
}

function createAgent(record, processedSeq, onRequest, onAck, onWelcome) {
  const capabilities = [
    "encoding.json",
    "event.batch",
    "event.replay",
    "event.ack.processed",
    "flow.backpressure",
    "sandbox.runtime.v1",
    "sandbox.events.v1",
    "sandbox.snapshots.v1",
    "operation.task.list",
  ];
  const messages = createMessageFactory({
    source: {
      role: "sandbox_agent",
      id: record.sandboxId,
      instanceId: record.instanceId,
    },
    target: { role: "sandbox_manager", id: "sandbox-manager" },
  });
  const dispatcher = new RpcDispatcher({
    handlers: {
      "task.list": (_params, request) => {
        onRequest(request);
        return { tasks: [] };
      },
    },
    acceptedCapabilities: () => capabilities,
  });
  return new ProtocolClientConnection({
    transport: nodeWebSocketTransportFactory(
      () =>
        new WebSocket(record.controller.url, {
          headers: { authorization: `Bearer ${record.controller.token}` },
        }),
    ),
    reconnect: new ReconnectPolicy({ maximumAttempts: 0 }),
    onStateChange: (value) => console.log(`sandbox protocol state: ${value}`),
    onError: (error) =>
      console.error(
        `sandbox protocol error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: messages,
        capabilities,
        requiredCapabilities: [
          "encoding.json",
          "event.batch",
          "event.ack.processed",
        ],
        cursors: () => [
          { stream: `sandbox:${record.sandboxId}`, processedSeq },
        ],
        send,
        onDisconnect,
        rpcDispatcher: dispatcher,
        awaitReady: (welcome) => onWelcome?.(welcome),
        onAck: (message) => {
          const cursor = message.data.streams.find(
            (item) => item.stream === `sandbox:${record.sandboxId}`,
          );
          if (cursor) onAck(cursor.processedSeq);
        },
      }),
  });
}

async function startPostgres() {
  const configured = process.env.NERVE_TEST_POSTGRES_URL?.trim();
  if (configured)
    return {
      url: configured,
      diagnose: () => undefined,
      stop: async () => undefined,
    };
  const cli = process.env.NERVE_CONTAINER_CLI?.trim() || "docker";
  const port = await availablePort();
  const name = `nerve-release-postgres-${process.pid}-${Date.now()}`;
  run(cli, [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=nerve",
    "-e",
    "POSTGRES_DB=nerve",
    "-p",
    `127.0.0.1:${port}:5432`,
    "postgres:16-alpine",
  ]);
  const databaseReady = () =>
    spawnSync(
      cli,
      ["exec", name, "psql", "-U", "postgres", "-d", "nerve", "-c", "select 1"],
      { stdio: "ignore" },
    ).status === 0;
  try {
    await waitUntil(databaseReady, 30_000, "PostgreSQL initialization");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));
    await waitUntil(databaseReady, 30_000, "PostgreSQL final server");
  } catch (error) {
    spawnSync(cli, ["rm", "-f", name], { stdio: "ignore" });
    throw error;
  }
  return {
    url: `postgresql://postgres:nerve@127.0.0.1:${port}/nerve`,
    diagnose: () => {
      spawnSync(cli, ["logs", name], { stdio: "inherit" });
    },
    stop: async () => {
      spawnSync(cli, ["rm", "-f", name], { stdio: "ignore" });
    },
  };
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      const port =
        typeof address === "object" && address ? address.port : undefined;
      socket.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitUntil(predicate, timeoutMs, label) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}`,
    );
}
