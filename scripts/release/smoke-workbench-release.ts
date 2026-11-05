#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { createRequire } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { createMessageFactory } from "../../packages/protocol/dist/index.js";
import {
  ProtocolClientConnection,
  ProtocolClientSession,
  ReconnectPolicy,
} from "../../packages/protocol/dist/client.js";
import {
  nodeWebSocketTransportFactory,
  protocolRequest,
} from "../../packages/protocol/dist/adapters/index.js";
import { repoRoot } from "../workspace/repo.ts";

const require = createRequire(
  new URL("../../packages/workbench-server/package.json", import.meta.url),
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
let child: ChildProcess | undefined;
let client: ProtocolClientConnection | undefined;

try {
  child = spawn(
    process.execPath,
    [serverMain, "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NERVE_HOME: home,
        NERVE_PORT: String(port),
        NERVE_MOBILE_HTTPS: "0",
        NERVE_HTTPS_PORT: String(port + 1),
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  child.on("exit", (code) => {
    if (code && code !== 0) output += `\nserver exited ${code}`;
  });

  // The server answers /health while it is still starting; wait for ready.
  const health = await waitForJson(
    `${origin}/health`,
    20_000,
    () => output,
    (body) => body?.lifecycle === "ready",
  );
  if (!health || typeof health !== "object")
    throw new Error("health response is not JSON");
  const token = (
    await readFile(join(home, "secrets", "daemon-token"), "utf8")
  ).trim();
  const authenticatedFetch: typeof fetch = (input, init = {}) => {
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
  if (!htmlResponse.ok)
    throw new Error(
      `bundled workbench index request failed: ${describeResponse(htmlResponse, html)}`,
    );
  if (!/<div\b[^>]*\bid=(["'])app\1[^>]*>/i.test(html))
    throw new Error(
      `bundled workbench index has no #app mount: ${describeResponse(htmlResponse, html)}`,
    );
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
  const connection = new ProtocolClientConnection({
    transport: nodeWebSocketTransportFactory(
      () =>
        new WebSocket(`ws://127.0.0.1:${port}/ws/workbench`, {
          headers: { authorization: `Bearer ${token}` },
        }),
    ),
    reconnect: new ReconnectPolicy({ maximumAttempts: 0 }),
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: messages,
        capabilities: [
          "encoding.json",
          "event.notify",
          "operation.settings.get",
        ],
        requiredCapabilities: ["encoding.json", "event.notify"],
        cursors: () => [],
        send,
        onDisconnect,
        applyEvent: () => undefined,
      }),
  });
  client = connection;
  await connection.start();
  await waitUntil(
    () => connection.state === "ready",
    10_000,
    "WebSocket protocol ready",
  );
  const websocket = await connection.request("settings.get", {});
  if (JSON.stringify(websocket) !== JSON.stringify(http.result))
    throw new Error("HTTP and WebSocket settings.get results differ");
  await connection.close();
  client = undefined;

  await stopChild(child);
  child = undefined;
  console.log(`Workbench release smoke passed at ${origin}.`);
} finally {
  await client?.close().catch(() => undefined);
  if (child) {
    const running = child;
    await stopChild(running).catch(() => running.kill("SIGKILL"));
  }
  await rm(home, { recursive: true, force: true });
}

async function availablePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected =
        typeof address === "object" && address ? address.port : undefined;
      server.close((error) =>
        error || selected === undefined
          ? reject(error ?? new Error("no port assigned"))
          : resolvePort(selected),
      );
    });
  });
}

/** The fields of the server's JSON responses this smoke test reads. */
interface JsonBody {
  lifecycle?: string;
  status?: { version?: string };
  result?: unknown;
}

async function waitForJson(
  url: string,
  timeoutMs: number,
  diagnostics: () => string,
  accept: (body: JsonBody) => boolean = () => true,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = (await response.json()) as JsonBody;
        if (accept(body)) return body;
      }
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}\n${diagnostics()}`);
}

async function fetchJson(
  url: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<JsonBody> {
  const response = await fetchImplementation(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return (await response.json()) as JsonBody;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`Timed out waiting for ${label}`);
    await delay(25);
  }
}

async function stopChild(process_: ChildProcess) {
  if (process_.exitCode !== null) return;
  process_.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => process_.once("exit", resolveExit)),
    delay(5_000).then(() => {
      if (process_.exitCode === null) process_.kill("SIGKILL");
    }),
  ]);
}

function describeResponse(response: Response, body: string) {
  const contentType = response.headers.get("content-type") ?? "unknown";
  const preview = body.slice(0, 500).replace(/\s+/g, " ").trim();
  return `HTTP ${response.status}, content-type ${contentType}, body ${JSON.stringify(preview)}`;
}

function delay(ms: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
