import assert from "node:assert/strict";
import test from "node:test";
import type { NerveMessage, ProtocolV1Message } from "@nervekit/contracts/wire";
import { ProtocolConnection, createMessageFactory } from "../../src/index.js";
import { ProtocolServerSession } from "../../src/server.js";
import { RpcDispatcher } from "../../src/rpc/index.js";
import { ManualTransport } from "../test-runtime.js";
import { ProtocolCodec } from "../../src/transports/codec.js";

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
  maxMessageBytes = 1_000_000,
) {
  const codec = new ProtocolCodec({ maxMessageBytes });
  const oversized: NerveMessage[] = [];
  const outbound: ProtocolV1Message[] = [];
  const server = new ProtocolServerSession({
    acceptingPeer: { role: "workbench_server", id: "server_rpc_concurrency" },
    createMessage: serverMessages,
    capabilities,
    limits: {
      maxMessageBytes,
      maxBatchEvents: 100,
      maxBatchBytes: 1_000_000,
    },
    heartbeat: { intervalMs: 60_000, timeoutMs: 120_000 },
    sessionId: () => "session_rpc_concurrency",
    send: (message: NerveMessage) => {
      codec.encode(message);
      outbound.push(message as ProtocolV1Message);
    },
    onMessageTooLarge: (message) => {
      oversized.push(message);
    },
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
  return { connection, outbound, oversized, server, transport };
}

function request(
  method: "status.latestRelease.get" | "project.create",
  params: unknown,
): ProtocolV1Message {
  if (method === "project.create") {
    const { dir } = params as { dir: string };
    params = { id: `proj_${dir}`, name: dir, directory: dir };
  }
  return clientMessages("request", { method, params }) as ProtocolV1Message;
}

function project(dir: string) {
  return {
    id: `proj_${dir.replaceAll("/", "_")}`,
    name: dir,
    directory: dir,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
    "project.create": async ({ directory: dir }) => {
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
    "project.create": async ({ directory: dir }) => {
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

for (const method of ["status.latestRelease.get", "project.create"] as const) {
  test(`an oversized ${method} reply fails only its request`, async () => {
    const { connection, outbound, server, transport } = await fixture(
      {
        "status.latestRelease.get": () => ({
          version: "1.0.0",
          releaseUrl: `https://example.com/${"x".repeat(10_000)}`,
          publishedAt: "2026-01-01T00:00:00.000Z",
        }),
        "project.create": ({ directory: dir }) =>
          project(dir === "/large" ? "x".repeat(10_000) : dir),
      },
      2_000,
    );
    try {
      const oversized = request(
        method,
        method === "project.create" ? { dir: "/large" } : {},
      );
      await transport.emit(oversized);
      await connection.drain();
      await tick();
      const error = outbound.find(
        (message) => message.replyTo === oversized.id,
      );
      assert.equal(error?.kind, "error");
      if (error?.kind === "error")
        assert.equal(error.data.code, "MESSAGE_TOO_LARGE");
      assert.equal(server.state, "ready");
      assert.equal(
        outbound.some((message) => message.kind === "goodbye"),
        false,
      );
      const next = request("project.create", { dir: "/small" });
      await transport.emit(next);
      await connection.drain();
      assert.ok(
        outbound.some(
          (message) =>
            message.kind === "response" && message.replyTo === next.id,
        ),
      );
    } finally {
      connection.dispose();
      server.dispose();
    }
  });
}

test("oversized ephemeral notifications are logged and skipped without losing smaller notices", async () => {
  const { connection, outbound, oversized, server } = await fixture({}, 2_000);
  try {
    await server.notify({
      id: "evt_large",
      ts: "2026-01-01T00:00:00.000Z",
      type: "capabilities.changed",
      data: { projectId: "x".repeat(10_000) },
    });
    await server.notify({
      id: "evt_small",
      ts: "2026-01-01T00:00:00.000Z",
      type: "capabilities.changed",
      data: { projectId: "proj_small" },
    });
    await server.flush();
    assert.equal(oversized.length, 1);
    assert.equal(server.state, "ready");
    assert.equal(
      outbound.some((message) => message.kind === "goodbye"),
      false,
    );
    assert.ok(
      outbound.some(
        (message) =>
          message.kind === "event.notify" &&
          message.data.events.some((event) => event.id === "evt_small"),
      ),
    );
  } finally {
    connection.dispose();
    server.dispose();
  }
});
