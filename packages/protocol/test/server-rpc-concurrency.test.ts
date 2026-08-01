import assert from "node:assert/strict";
import test from "node:test";
import type { NerveMessage, ProtocolV1Message } from "@nervekit/contracts";
import {
  ProtocolConnection,
  ProtocolServerSession,
  RpcDispatcher,
  createMessageFactory,
} from "../src/index.js";
import { ManualTransport } from "./test-runtime.js";

const capabilities = [
  "stream.subscription.v1",
  "operation.status.latestRelease.get",
  "operation.project.create",
];
const clientMessages = createMessageFactory({
  source: { role: "ui", id: "ui_rpc_concurrency" },
  target: { role: "workbench_server", id: "server_rpc_concurrency" },
});
const serverMessages = createMessageFactory({
  source: { role: "workbench_server", id: "server_rpc_concurrency" },
  target: { role: "ui", id: "ui_rpc_concurrency" },
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

async function fixture(
  handlers: ConstructorParameters<typeof RpcDispatcher>[0]["handlers"],
) {
  const outbound: ProtocolV1Message[] = [];
  const server = new ProtocolServerSession({
    acceptingPeer: { role: "workbench_server", id: "server_rpc_concurrency" },
    createMessage: serverMessages,
    capabilities,
    limits: {
      maxMessageBytes: 1_000_000,
      maxBatchEvents: 100,
      maxBatchBytes: 1_000_000,
    },
    heartbeat: { intervalMs: 60_000, timeoutMs: 120_000 },
    sessionId: () => "session_rpc_concurrency",
    send: (message: NerveMessage) =>
      outbound.push(message as ProtocolV1Message),
    rpcDispatcher: new RpcDispatcher({
      handlers,
      acceptedCapabilities: capabilities,
    }),
  });
  const transport = new ManualTransport();
  const connection = new ProtocolConnection({
    transport,
    onMessage: (message) => server.receive(message),
  });
  await transport.emit(
    clientMessages("hello", {
      requestedVersion: 1,
      capabilities,
      requiredCapabilities: capabilities,
      encodings: ["json"],
    }) as ProtocolV1Message,
  );
  await transport.emit(
    clientMessages("ready", {
      sessionId: "session_rpc_concurrency",
    }) as ProtocolV1Message,
  );
  assert.equal(server.state, "ready", JSON.stringify(outbound));
  await connection.drain();
  outbound.splice(0);
  return { connection, outbound, server, transport };
}

function request(
  method: "status.latestRelease.get" | "project.create",
  params: unknown,
): ProtocolV1Message {
  return clientMessages("request", { method, params }) as ProtocolV1Message;
}

function project(dir: string) {
  return {
    project: {
      id: `proj_${dir.replaceAll("/", "_")}`,
      name: dir,
      dir,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

test("a slow read does not block a later mutation", async () => {
  const readGate = deferred<void>();
  const started: string[] = [];
  const { connection, outbound, server, transport } = await fixture({
    "status.latestRelease.get": async () => {
      started.push("read");
      await readGate.promise;
      return {
        version: "1.0.0",
        releaseUrl: "https://example.com/release",
        publishedAt: "2026-01-01T00:00:00.000Z",
      };
    },
    "project.create": async ({ dir }) => {
      started.push("mutation");
      return project(dir);
    },
  });

  const read = request("status.latestRelease.get", {});
  const mutation = request("project.create", { dir: "/project" });
  void transport.emit(read);
  void transport.emit(mutation);
  await tick();
  await tick();

  assert.deepEqual(started, ["read", "mutation"]);
  assert.ok(
    outbound.some(
      (message) =>
        message.kind === "response" && message.replyTo === mutation.id,
    ),
  );
  assert.equal(
    outbound.some((message) => message.replyTo === read.id),
    false,
  );

  readGate.resolve();
  await tick();
  assert.ok(
    outbound.some(
      (message) => message.kind === "response" && message.replyTo === read.id,
    ),
  );
  connection.dispose();
  server.dispose();
});

test("mutations remain ordered by the connection receive queue", async () => {
  const firstGate = deferred<void>();
  const started: string[] = [];
  const { connection, server, transport } = await fixture({
    "project.create": async ({ dir }) => {
      started.push(dir);
      if (dir === "/first") await firstGate.promise;
      return project(dir);
    },
  });

  void transport.emit(request("project.create", { dir: "/first" }));
  void transport.emit(request("project.create", { dir: "/second" }));
  await tick();
  assert.deepEqual(started, ["/first"]);

  firstGate.resolve();
  await tick();
  await tick();
  assert.deepEqual(started, ["/first", "/second"]);
  connection.dispose();
  server.dispose();
});

test("a detached read does not send after session disposal", async () => {
  const readGate = deferred<void>();
  const { connection, outbound, server, transport } = await fixture({
    "status.latestRelease.get": async () => {
      await readGate.promise;
      return {
        version: "1.0.0",
        releaseUrl: "https://example.com/release",
        publishedAt: "2026-01-01T00:00:00.000Z",
      };
    },
  });

  void transport.emit(request("status.latestRelease.get", {}));
  await tick();
  server.dispose();
  readGate.resolve();
  await tick();
  assert.deepEqual(outbound, []);
  connection.dispose();
});
