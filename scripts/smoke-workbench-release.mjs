#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { createRequire } from "node:module";
import os from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMessageFactory,
  nodeWebSocketTransportFactory,
  protocolRequest,
  ProtocolClientConnection,
  ProtocolClientSession,
  ReconnectPolicy,
} from "../packages/protocol/dist/index.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(
  new URL("../packages/protocol/package.json", import.meta.url),
);
const { WebSocket } = require("ws");
const serverMain = join(
  repoRoot,
  "packages",
  "workbench-server",
  "dist",
  "main.js",
);
const expectedVersion = JSON.parse(
  await readFile(join(repoRoot, "package.json"), "utf8"),
).version;
const home = await mkdtemp(join(os.tmpdir(), "nerve-workbench-smoke-"));
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
let child;
let client;

try {
  child = spawn(
    process.execPath,
    [serverMain, "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: repoRoot,
      env: { ...process.env, NERVE_HOME: home, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  child.on("exit", (code) => {
    if (code && code !== 0) output += `\nserver exited ${code}`;
  });

  const health = await waitForJson(`${origin}/health`, 20_000, () => output);
  if (!health || typeof health !== "object")
    throw new Error("health response is not JSON");
  const token = (
    await readFile(join(home, "auth", "local-token"), "utf8")
  ).trim();
  const authenticatedFetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers }).then(async (response) => {
      if (String(input).includes("/api/protocol/v1")) {
        const body = await response.clone().text();
        if (!body.includes('"protocol":"nerve"'))
          throw new Error(`Protocol HTTP returned ${response.status}: ${body}`);
      }
      return response;
    });
  };
  const config = await fetchJson(
    `${origin}/api/client-config`,
    authenticatedFetch,
  );
  if (config?.status?.version !== expectedVersion)
    throw new Error(
      `unexpected client config version: ${config?.status?.version}`,
    );

  const htmlResponse = await fetch(`${origin}/`);
  const html = await htmlResponse.text();
  if (!htmlResponse.ok || !html.includes('<div id="app"></div>'))
    throw new Error("bundled workbench index.html was not served");
  const assetPath = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
  if (!assetPath)
    throw new Error("bundled workbench index has no static asset");
  const asset = await fetch(`${origin}${assetPath}`);
  if (!asset.ok || Number(asset.headers.get("content-length") ?? 1) === 0)
    throw new Error(`bundled workbench asset failed: ${assetPath}`);

  const http = await protocolRequest(
    "settings.get",
    {},
    {
      apiPath: `${origin}/api/protocol/v1`,
      source: { role: "ui", id: "smoke-http", instanceId: "smoke-http-1" },
      target: { role: "workbench_server" },
      fetch: authenticatedFetch,
    },
  );

  const messages = createMessageFactory({
    source: { role: "ui", id: "smoke-ws", instanceId: "smoke-ws-1" },
    target: { role: "workbench_server" },
  });
  client = new ProtocolClientConnection({
    transport: nodeWebSocketTransportFactory(
      () =>
        new WebSocket(`ws://127.0.0.1:${port}/ws`, {
          headers: { authorization: `Bearer ${token}` },
        }),
    ),
    reconnect: new ReconnectPolicy({ maximumAttempts: 0 }),
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: messages,
        capabilities: [
          "encoding.json",
          "event.batch",
          "event.replay",
          "event.ack.processed",
          "flow.backpressure",
          "snapshot.workspace",
          "operation.settings.get",
        ],
        requiredCapabilities: ["encoding.json", "event.batch"],
        cursors: () => [{ stream: "local", processedSeq: 0 }],
        send,
        onDisconnect,
        applyEvent: () => undefined,
      }),
  });
  await client.start();
  await waitUntil(
    () => client.state === "ready",
    10_000,
    "WebSocket protocol ready",
  );
  const websocket = await client.request("settings.get", {});
  if (JSON.stringify(websocket) !== JSON.stringify(http.result))
    throw new Error("HTTP and WebSocket settings.get results differ");
  await client.close();
  client = undefined;

  await stopChild(child);
  child = undefined;
  console.log(`Workbench release smoke passed at ${origin}.`);
} finally {
  await client?.close().catch(() => undefined);
  if (child) await stopChild(child).catch(() => child.kill("SIGKILL"));
  await rm(home, { recursive: true, force: true });
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected =
        typeof address === "object" && address ? address.port : undefined;
      server.close((error) => (error ? reject(error) : resolvePort(selected)));
    });
  });
}

async function waitForJson(url, timeoutMs, diagnostics) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}\n${diagnostics()}`);
}

async function fetchJson(url, fetchImplementation = fetch) {
  const response = await fetchImplementation(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function waitUntil(predicate, timeoutMs, label) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`Timed out waiting for ${label}`);
    await delay(25);
  }
}

async function stopChild(process_) {
  if (process_.exitCode !== null) return;
  process_.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => process_.once("exit", resolveExit)),
    delay(5_000).then(() => {
      if (process_.exitCode === null) process_.kill("SIGKILL");
    }),
  ]);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
