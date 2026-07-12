import {
  allOperationDefinitions,
  type NerveMessage,
} from "@nervekit/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  ProtocolCodec,
  ProtocolDecodeError,
  ProtocolClientSession,
  ProtocolServerSession,
  ProcessedAckTracker,
  ReconnectPolicy,
  RpcClient,
  RpcDispatcher,
  createClientEventStreamState,
  createMessageFactory,
  applyEventBatch,
  buildEventBatch,
  MemoryIdempotencyStore,
} from "../src/index.js";

const ui = { role: "ui" as const, id: "ui_test" };
const server = { role: "workbench_server" as const, id: "server_test" };
const clientMessages = createMessageFactory({ source: ui, target: server });
const serverMessages = createMessageFactory({ source: server, target: ui });

const limits = {
  maxMessageBytes: 1_048_576,
  maxBatchEvents: 100,
  maxBatchBytes: 262_144,
  maxInflightBatches: 4,
  maxUnackedDurableEvents: 1_000,
};

test("strict codec rejects malformed, unsupported, unknown, and secret-like frames", () => {
  const codec = new ProtocolCodec();
  assert.throws(
    () => codec.decode("{"),
    (error) => code(error) === "INVALID_JSON",
  );
  assert.throws(
    () => codec.decode(JSON.stringify({ protocol: "nerve", version: 2 })),
    (error) => code(error) === "PROTOCOL_VERSION_UNSUPPORTED",
  );
  const unknown = {
    ...clientMessages("hello", helloData()),
    kind: "required.future",
  };
  assert.throws(
    () => codec.decode(JSON.stringify(unknown)),
    (error) => code(error) === "UNKNOWN_MESSAGE_KIND",
  );
  const secret = clientMessages("hello", helloData(), {
    meta: { authorization_token: "redacted" },
  });
  assert.throws(
    () => codec.decode(JSON.stringify(secret)),
    (error) => code(error) === "INVALID_MESSAGE",
  );
});

test("client and server negotiate hello, welcome, and ready", async () => {
  const clientOutbound: unknown[] = [];
  const serverOutbound: unknown[] = [];
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    capabilities: ["rpc", "events"],
    requiredCapabilities: ["rpc"],
    cursors: () => [{ stream: "local", processedSeq: 4 }],
    send: (message) => clientOutbound.push(message),
  });
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    capabilities: ["rpc", "events", "replay"],
    streams: () => [{ stream: "local", latestSeq: 5 }],
    limits,
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_test",
    resume: () => ({ accepted: true, mode: "replay" }),
    send: (message) => serverOutbound.push(message),
  });

  await client.start();
  await host.receive(clientOutbound.shift() as never);
  await client.receive(serverOutbound.shift() as never);
  await host.receive(clientOutbound.shift() as never);
  assert.equal(client.state, "ready");
  assert.equal(host.state, "ready");
  assert.equal(client.sessionId, "session_test");
});

test("client readiness gate and peer-owned event ACK use shared sessions", async () => {
  const clientOutbound: NerveMessage[] = [];
  const serverOutbound: NerveMessage[] = [];
  let releaseReady!: () => void;
  const readyGate = new Promise<void>((resolve) => {
    releaseReady = resolve;
  });
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    capabilities: ["events"],
    awaitReady: () => readyGate,
    send: (message) => clientOutbound.push(message),
  });
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    capabilities: ["events"],
    streams: () => [],
    limits,
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_peer_events",
    send: (message) => serverOutbound.push(message),
    onEventBatch: async (message) => ({
      streams: [
        {
          stream: message.data.stream,
          processedSeq: message.data.events.at(-1)?.seq ?? 0,
        },
      ],
      appliedEvents: message.data.events.length,
    }),
  });
  await client.start();
  await host.receive(clientOutbound.shift() as never);
  const receivingWelcome = client.receive(serverOutbound.shift() as never);
  await Promise.resolve();
  assert.equal(clientOutbound.length, 0);
  releaseReady();
  await receivingWelcome;
  await host.receive(clientOutbound.shift() as never);

  await client.publishEventBatch(
    buildEventBatch(
      [
        {
          id: "evt_peer_1",
          seq: 1,
          type: "project.created",
          ts: new Date().toISOString(),
          durability: "durable",
          data: {},
        },
      ],
      { stream: "sandbox:test", reason: "replay", previousDurableSeq: 0 },
    ),
  );
  await host.receive(clientOutbound.shift() as never);
  assert.equal(serverOutbound.at(-1)?.kind, "event.ack");
  assert.deepEqual(
    (serverOutbound.at(-1) as Extract<NerveMessage, { kind: "event.ack" }>).data
      .streams,
    [{ stream: "sandbox:test", processedSeq: 1 }],
  );
  client.disconnect();
  host.dispose();
});

test("server rejects a non-hello first message", async () => {
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [],
    limits,
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_test",
    send: () => undefined,
  });
  await assert.rejects(
    host.receive(clientMessages("ready", { sessionId: "nope" }) as never),
    /hello must be the first/,
  );
});

test("server session serves bounded replay and rejects stale cursors", async () => {
  const outbound: NerveMessage[] = [];
  const event = {
    seq: 2,
    id: "evt_server_replay_2",
    ts: new Date().toISOString(),
    type: "project.created",
    durability: "durable" as const,
    data: {},
  };
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [
      {
        stream: "local",
        latestSeq: 2,
        durableSeq: 2,
        replayAvailableFromSeq: 2,
      },
    ],
    replaySource: {
      streams: () => [
        {
          stream: "local",
          latestSeq: 2,
          durableSeq: 2,
          replayAvailableFromSeq: 2,
        },
      ],
      read: () => ({ available: true, events: [event], complete: true }),
    },
    limits,
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_server_replay",
    send: (message) => outbound.push(message),
  });
  await host.receive(clientMessages("hello", helloData()) as never);
  await host.receive(
    clientMessages("ready", { sessionId: "session_server_replay" }) as never,
  );
  outbound.length = 0;
  await host.receive(
    clientMessages("replay.request", {
      sessionId: "session_server_replay",
      replayId: "rpl_server",
      streams: [{ stream: "local", fromSeq: 2 }],
      reason: "gap",
    }) as never,
  );
  assert.deepEqual(
    outbound.map((message) => message.kind),
    ["replay.started", "event.batch", "replay.complete"],
  );
  outbound.length = 0;
  await host.receive(
    clientMessages("replay.request", {
      sessionId: "session_server_replay",
      replayId: "rpl_stale",
      streams: [{ stream: "local", fromSeq: 1 }],
      reason: "retention_gap",
    }) as never,
  );
  assert.equal(outbound[0]?.kind, "replay.unavailable");
  assert.equal(
    (outbound[0]?.data as { streams: Array<{ reason: string }> }).streams[0]
      ?.reason,
    "cursor_too_old",
  );
});

test("RPC correlates responses, validates targets, and replays idempotent results", async () => {
  const dispatcher = new RpcDispatcher({
    handlers: {
      "applicationLog.prune": () => ({ pruned: 1, remaining: 2 }),
    },
    idempotency: new MemoryIdempotencyStore(),
  });
  const rpc = new RpcClient({
    createMessage: clientMessages,
    send: async (request) => {
      const first = await dispatcher.dispatch(request as never);
      assert.equal(first.ok, true);
      const second = await dispatcher.dispatch(request as never);
      assert.deepEqual(second, first);
      rpc.handle(
        serverMessages(
          "response",
          {
            ok: true,
            method: "applicationLog.prune",
            result: first.ok ? first.result : undefined,
          },
          { replyTo: request.id, correlationId: request.id },
        ),
      );
    },
  });
  assert.deepEqual(
    await rpc.request("applicationLog.prune", {}, { idempotencyKey: "same" }),
    { pruned: 1, remaining: 2 },
  );
});

test("RPC enforces catalog idempotency and sandbox target identity", async () => {
  const dispatcher = new RpcDispatcher({
    handlers: { "task.list": () => ({ tasks: [] }) },
  });
  const missingTarget = clientMessages(
    "request",
    { method: "task.list", params: {} },
    { target: { role: "sandbox_agent" } },
  );
  assert.deepEqual(await dispatcher.dispatch(missingTarget as never), {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message: "Sandbox agent requests require a nonempty target id",
      retryable: false,
    },
  });
  const forbiddenKey = clientMessages("request", {
    method: "settings.get",
    params: {},
    idempotencyKey: "not-allowed",
  });
  const result = await dispatcher.dispatch(forbiddenKey as never);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "VALIDATION_FAILED");
});

test("every catalog operation enforces role, capability, and idempotency metadata", async () => {
  for (const definition of allOperationDefinitions()) {
    const dispatcher = new RpcDispatcher({
      handlers: {},
      acceptedCapabilities: [],
    });
    const forbidden = clientMessages(
      "request",
      { method: definition.method, params: {} },
      { target: { role: "ui" } },
    );
    const forbiddenResult = await dispatcher.dispatch(forbidden as never);
    assert.equal(forbiddenResult.ok, false, definition.method);
    if (!forbiddenResult.ok)
      assert.equal(
        forbiddenResult.error.code,
        "AUTH_FORBIDDEN",
        definition.method,
      );

    const role = definition.allowedTargetRoles[0];
    const target =
      role === "sandbox_agent"
        ? { role, id: "sbx_test" }
        : { role, id: `${role}_test` };
    const capabilityResult = await dispatcher.dispatch(
      clientMessages(
        "request",
        { method: definition.method, params: {} },
        { target },
      ) as never,
    );
    assert.equal(capabilityResult.ok, false, definition.method);
    if (!capabilityResult.ok)
      assert.equal(
        capabilityResult.error.code,
        "CAPABILITY_REQUIRED",
        definition.method,
      );

    const idempotencyDispatcher = new RpcDispatcher({
      handlers: {},
      acceptedCapabilities: [definition.requiredCapability],
    });
    if (definition.idempotency === "none") {
      const result = await idempotencyDispatcher.dispatch(
        clientMessages(
          "request",
          {
            method: definition.method,
            params: {},
            idempotencyKey: "forbidden",
          },
          { target },
        ) as never,
      );
      assert.equal(result.ok, false, definition.method);
      if (!result.ok) assert.equal(result.error.code, "VALIDATION_FAILED");
    }
    if (definition.idempotency === "required") {
      const result = await idempotencyDispatcher.dispatch(
        clientMessages(
          "request",
          { method: definition.method, params: {} },
          { target },
        ) as never,
      );
      assert.equal(result.ok, false, definition.method);
      if (!result.ok) assert.equal(result.error.code, "VALIDATION_FAILED");
    }
  }
});

test("event continuity and processed ACKs are independent per stream", () => {
  const local = createClientEventStreamState(0);
  const sandbox = createClientEventStreamState(0);
  const tracker = new ProcessedAckTracker();
  const event = (seq: number) => ({
    seq,
    id: `evt_${seq}`,
    ts: new Date().toISOString(),
    type: "run.started",
    durability: "durable" as const,
    data: {},
  });
  const localBatch = buildEventBatch([event(1)], {
    stream: "manager",
    reason: "live",
    previousDurableSeq: 0,
  });
  const sandboxBatch = buildEventBatch([event(1)], {
    stream: "sandbox:one",
    reason: "live",
    previousDurableSeq: 0,
  });
  applyEventBatch(localBatch, local, () => undefined, "manager");
  applyEventBatch(sandboxBatch, sandbox, () => undefined, "sandbox:one");
  tracker.markReceived("manager", 1);
  tracker.markReceived("sandbox:one", 1);
  tracker.markProcessed("manager", 1);
  assert.deepEqual(tracker.cursors(), [{ stream: "manager", processedSeq: 1 }]);
  tracker.markProcessed("sandbox:one", 1);
  assert.deepEqual(tracker.cursors(), [
    { stream: "manager", processedSeq: 1 },
    { stream: "sandbox:one", processedSeq: 1 },
  ]);
});

test("client session applies durable events before ACK and requests replay on gaps", async () => {
  const outbound: NerveMessage[] = [];
  const applied: number[] = [];
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    capabilities: ["event.batch", "event.replay", "event.ack.processed"],
    cursors: () => [{ stream: "manager", processedSeq: 0 }],
    applyEvent: async (_stream, event) => applied.push(event.seq),
    send: (message) => outbound.push(message),
  });
  await client.start();
  await client.receive(
    serverMessages("welcome", {
      sessionId: "session_events",
      acceptingPeer: server,
      acceptedVersion: 1,
      capabilities: ["event.batch", "event.replay", "event.ack.processed"],
      encoding: "json",
      streams: [{ stream: "manager", latestSeq: 3 }],
      limits,
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
      resume: { accepted: true, mode: "live" },
    }) as never,
  );
  outbound.length = 0;
  const event = {
    seq: 1,
    id: "evt_1",
    ts: new Date().toISOString(),
    type: "project.created",
    durability: "durable" as const,
    data: {},
  };
  await client.receive(
    serverMessages(
      "event.batch",
      buildEventBatch([event], {
        stream: "manager",
        reason: "live",
        previousDurableSeq: 0,
      }),
    ) as never,
  );
  assert.deepEqual(applied, [1]);
  assert.equal(outbound.at(-1).kind, "event.ack");
  assert.deepEqual(outbound.at(-1).data.streams, [
    { stream: "manager", processedSeq: 1 },
  ]);

  outbound.length = 0;
  await client.receive(
    serverMessages(
      "event.batch",
      buildEventBatch([{ ...event, seq: 3, id: "evt_3" }], {
        stream: "manager",
        reason: "live",
        previousDurableSeq: 2,
      }),
    ) as never,
  );
  assert.equal(outbound.at(-1).kind, "replay.request");
  assert.deepEqual(outbound.at(-1).data.streams, [
    { stream: "manager", fromSeq: 2 },
  ]);
});

test("client buffers live events until replay completes", async () => {
  const applied: number[] = [];
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    cursors: () => [{ stream: "manager", processedSeq: 0 }],
    applyEvent: async (_stream, event) => applied.push(event.seq),
    send: () => undefined,
  });
  await client.start();
  await client.receive(
    serverMessages("welcome", {
      sessionId: "session_replay",
      acceptingPeer: server,
      acceptedVersion: 1,
      capabilities: [],
      encoding: "json",
      streams: [{ stream: "manager", latestSeq: 2 }],
      limits,
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
      resume: { accepted: true, mode: "replay" },
    }) as never,
  );
  await client.receive(
    serverMessages("replay.started", {
      sessionId: "session_replay",
      replayId: "rpl_1",
      streams: [
        {
          stream: "manager",
          fromSeq: 1,
          toSeq: 1,
          latestSeq: 2,
          source: "log",
        },
      ],
    }) as never,
  );
  const event = (seq: number) => ({
    seq,
    id: `evt_replay_${seq}`,
    ts: new Date().toISOString(),
    type: "project.created",
    durability: "durable" as const,
    data: {},
  });
  await client.receive(
    serverMessages(
      "event.batch",
      buildEventBatch([event(2)], {
        stream: "manager",
        reason: "live",
        previousDurableSeq: 1,
      }),
    ) as never,
  );
  assert.deepEqual(applied, []);
  await client.receive(
    serverMessages(
      "event.batch",
      buildEventBatch([event(1)], {
        stream: "manager",
        reason: "replay",
        previousDurableSeq: 0,
      }),
    ) as never,
  );
  assert.deepEqual(applied, [1]);
  await client.receive(
    serverMessages("replay.complete", {
      sessionId: "session_replay",
      replayId: "rpl_1",
      streams: [
        {
          stream: "manager",
          fromSeq: 1,
          toSeq: 1,
          latestSeq: 2,
          durableCompleteThroughSeq: 1,
          sentEvents: 1,
          sentDurableEvents: 1,
          sentTransientEvents: 0,
        },
      ],
      liveDelivery: "resuming",
    }) as never,
  );
  assert.deepEqual(applied, [1, 2]);
});

test("client does not ACK when reducer application fails", async () => {
  const outbound: NerveMessage[] = [];
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    cursors: () => [{ stream: "local", processedSeq: 0 }],
    applyEvent: () => {
      throw new Error("reducer failed");
    },
    send: (message) => outbound.push(message),
  });
  await client.start();
  await client.receive(
    serverMessages("welcome", {
      sessionId: "session_failure",
      acceptingPeer: server,
      acceptedVersion: 1,
      capabilities: [],
      encoding: "json",
      streams: [{ stream: "local", latestSeq: 1 }],
      limits,
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
      resume: { accepted: true, mode: "live" },
    }) as never,
  );
  outbound.length = 0;
  const event = {
    seq: 1,
    id: "evt_failure",
    ts: new Date().toISOString(),
    type: "project.created",
    durability: "durable" as const,
    data: {},
  };
  await assert.rejects(
    client.receive(
      serverMessages(
        "event.batch",
        buildEventBatch([event], {
          stream: "local",
          reason: "live",
          previousDurableSeq: 0,
        }),
      ) as never,
    ),
    /reducer failed/,
  );
  assert.equal(
    outbound.some((message) => message.kind === "event.ack"),
    false,
  );
});

test("reconnect policy is bounded and deterministic with injected jitter", () => {
  const policy = new ReconnectPolicy({
    initialDelayMs: 100,
    maximumDelayMs: 500,
    jitter: 0,
    maximumAttempts: 4,
  });
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((attempt) => policy.delay(attempt)),
    [100, 200, 400, 500, undefined],
  );
});

function helloData() {
  return {
    requestedVersion: 1 as const,
    capabilities: ["rpc"],
    encodings: ["json" as const],
  };
}

function code(error: unknown): string | undefined {
  return error instanceof ProtocolDecodeError ? error.code : undefined;
}
