import type { NerveMessage, ProtocolV1Message } from "@nervekit/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  ProtocolClientConnection,
  ProtocolClientSession,
  ProtocolCodec,
  ProtocolServerSession,
  ProtocolSessionQueue,
  PrioritizedMessageSender,
  ReconnectPolicy,
  buildEventBatch,
  createMessageFactory,
} from "../src/index.js";
import { ManualRuntime, ManualTransport } from "./test-runtime.js";

const ui = { role: "ui" as const, id: "ui_lifecycle" };
const server = {
  role: "workbench_server" as const,
  id: "server_lifecycle",
};
const clientMessages = createMessageFactory({ source: ui, target: server });
const serverMessages = createMessageFactory({ source: server, target: ui });
const limits = {
  maxMessageBytes: 1_048_576,
  maxBatchEvents: 2,
  maxBatchBytes: 262_144,
  maxInflightBatches: 2,
  maxUnackedDurableEvents: 4,
};

test("server rejects disallowed peer roles before welcome", async () => {
  const outbound: NerveMessage[] = [];
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    allowedPeerRoles: ["ui"],
    createMessage: serverMessages,
    streams: () => [],
    limits,
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_forbidden",
    send: (message) => outbound.push(message),
  });
  const agentMessages = createMessageFactory({
    source: { role: "sandbox_agent", id: "sbx_one" },
    target: server,
  });
  await host.receive(
    agentMessages("hello", {
      requestedVersion: 1,
      capabilities: [],
      encodings: ["json"],
    }) as never,
  );
  assert.equal(host.state, "closed");
  assert.equal(outbound[0]?.kind, "error");
  assert.equal(outbound[0]?.data.code, "AUTH_FORBIDDEN");
});

test("snapshot recovery installs every cursor before requesting deltas", async () => {
  const outbound: NerveMessage[] = [];
  const order: string[] = [];
  const persisted: unknown[] = [];
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    cursors: () => [{ stream: "manager", processedSeq: 0 }],
    send: (message) => {
      order.push(`send:${message.kind}`);
      outbound.push(message);
    },
    snapshotRecovery: {
      load: () => ({
        snapshot: { selected: "sbx_one" },
        cursors: [
          { stream: "manager", processedSeq: 5 },
          { stream: "sandbox:one", processedSeq: 8 },
        ],
        stateEpoch: "epoch_2",
      }),
    },
    installSnapshot: (_snapshot, cursors, epoch) => {
      order.push(`install:${epoch}:${cursors.length}`);
    },
    processedEvents: {
      persist: (cursors) => {
        order.push("persist");
        persisted.push(cursors);
      },
    },
  });
  await client.start();
  await client.receive(
    serverMessages("welcome", {
      sessionId: "session_snapshot",
      acceptingPeer: server,
      acceptedVersion: 1,
      capabilities: [],
      encoding: "json",
      streams: [
        { stream: "manager", latestSeq: 6 },
        { stream: "sandbox:one", latestSeq: 9 },
      ],
      limits,
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
      resume: { accepted: false, mode: "snapshot_required" },
    }) as never,
  );

  assert.deepEqual(order.slice(-3), [
    "install:epoch_2:2",
    "persist",
    "send:replay.request",
  ]);
  assert.equal(persisted.length, 1);
  const replay = outbound.at(-1);
  assert.equal(replay?.kind, "replay.request");
  assert.deepEqual(replay?.data.streams, [
    { stream: "manager", fromSeq: 6 },
    { stream: "sandbox:one", fromSeq: 9 },
  ]);
  await client.close();
});

test("client keeps live events buffered until every overlapping replay completes", async () => {
  const applied: number[] = [];
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    cursors: () => [{ stream: "local", processedSeq: 0 }],
    send: () => undefined,
    applyEvent: (_stream, appliedEvent) => applied.push(appliedEvent.seq),
  });
  await client.start();
  await client.receive(welcome("session_overlapping_replay"));
  const started = (replayId: string) =>
    serverMessages("replay.started", {
      sessionId: "session_overlapping_replay",
      replayId,
      streams: [
        {
          stream: "local",
          fromSeq: 1,
          toSeq: 1,
          latestSeq: 1,
          source: "log",
        },
      ],
    }) as ProtocolV1Message;
  await client.receive(started("rpl_a"));
  await client.receive(started("rpl_b"));
  await client.receive(
    serverMessages(
      "event.batch",
      buildEventBatchForTest(event(1), "local", "live", 0),
    ) as ProtocolV1Message,
  );
  await client.receive(replayComplete("rpl_a"));
  assert.deepEqual(applied, []);
  await client.receive(replayComplete("rpl_b"));
  assert.deepEqual(applied, [1]);
  await client.close();
});

test("replay unavailable releases buffered live data into recovery", async () => {
  const outbound: NerveMessage[] = [];
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    cursors: () => [{ stream: "local", processedSeq: 0 }],
    send: (message) => outbound.push(message),
  });
  await client.start();
  await client.receive(welcome("session_unavailable_replay"));
  await client.receive(
    serverMessages("replay.started", {
      sessionId: "session_unavailable_replay",
      replayId: "rpl_unavailable",
      streams: [
        {
          stream: "local",
          fromSeq: 1,
          toSeq: 1,
          latestSeq: 2,
          source: "log",
        },
      ],
    }) as ProtocolV1Message,
  );
  await client.receive(
    serverMessages(
      "event.batch",
      buildEventBatchForTest(event(2), "local", "live", 1),
    ) as ProtocolV1Message,
  );
  outbound.length = 0;
  await client.receive(
    serverMessages("replay.unavailable", {
      sessionId: "session_unavailable_replay",
      replayId: "rpl_unavailable",
      streams: [
        {
          stream: "local",
          requestedFromSeq: 1,
          latestSeq: 2,
          reason: "storage_unavailable",
        },
      ],
      recovery: { action: "load_snapshot" },
    }) as ProtocolV1Message,
  );
  assert.equal(outbound.at(-1)?.kind, "replay.request");
  await client.close();
});

test("server chunks replay and releases live events after replay complete", async () => {
  const outbound: NerveMessage[] = [];
  const replayEvents = [event(1), event(2), event(3)];
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [{ stream: "local", latestSeq: 4 }],
    replaySource: {
      streams: () => [{ stream: "local", latestSeq: 4 }],
      read: ({ fromSeq }) =>
        fromSeq === 1
          ? { events: replayEvents.slice(0, 2), complete: false, nextSeq: 3 }
          : { events: replayEvents.slice(2), complete: true },
    },
    limits,
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_chunked",
    send: async (message) => {
      outbound.push(message);
      if (message.kind === "replay.started")
        await host.publish("local", event(4));
    },
  });
  await readyServer(host, "session_chunked");
  outbound.length = 0;
  await host.receive(
    clientMessages("replay.request", {
      sessionId: "session_chunked",
      replayId: "rpl_chunked",
      streams: [{ stream: "local", fromSeq: 1, toSeq: 3 }],
      reason: "manual_refresh",
    }) as never,
  );
  await Promise.resolve();

  assert.deepEqual(
    outbound.map((message) => message.kind),
    [
      "replay.started",
      "event.batch",
      "event.batch",
      "replay.complete",
      "event.batch",
    ],
  );
  assert.equal(outbound.at(-1)?.data.reason, "live");
  await host.shutdown();
});

test("server keeps live delivery paused across overlapping replays", async () => {
  const outbound: NerveMessage[] = [];
  const gates = [deferred(), deferred()];
  let readIndex = 0;
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [{ stream: "local", latestSeq: 2 }],
    replaySource: {
      streams: () => [{ stream: "local", latestSeq: 2 }],
      read: async () => {
        const gate = gates[readIndex++];
        await gate?.promise;
        return { events: [event(1)], complete: true };
      },
    },
    limits,
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_server_overlap",
    send: (message) => outbound.push(message),
  });
  await readyServer(host, "session_server_overlap");
  outbound.length = 0;
  const request = (replayId: string) =>
    clientMessages("replay.request", {
      sessionId: "session_server_overlap",
      replayId,
      streams: [{ stream: "local", fromSeq: 1, toSeq: 1 }],
      reason: "manual_refresh",
    }) as never;
  const first = host.receive(request("rpl_server_a"));
  await Promise.resolve();
  const second = host.receive(request("rpl_server_b"));
  await Promise.resolve();
  await host.publish("local", event(2));

  gates[0]?.resolve();
  await first;
  assert.equal(
    outbound.some(
      (message) =>
        message.kind === "event.batch" && message.data.reason === "live",
    ),
    false,
  );
  gates[1]?.resolve();
  await second;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    outbound.some(
      (message) =>
        message.kind === "event.batch" && message.data.reason === "live",
    ),
    true,
  );
  await host.shutdown();
});

test("outbound sender prioritizes control and replay over queued live data", async () => {
  const sent: string[] = [];
  const gate = deferred();
  const sender = new PrioritizedMessageSender(async (message) => {
    sent.push(message.id);
    if (message.id === "live_one") await gate.promise;
  });
  const message = (id: string) => ({
    ...clientMessages("heartbeat", {
      sessionId: "session_priority",
      sentAt: new Date().toISOString(),
    }),
    id,
  });
  const first = sender.send(message("live_one"), "live");
  const second = sender.send(message("live_two"), "live");
  const replay = sender.send(message("replay_one"), "replay");
  const control = sender.send(message("control_one"), "control");
  gate.resolve();
  await Promise.all([first, second, replay, control]);
  assert.deepEqual(sent, ["live_one", "control_one", "replay_one", "live_two"]);
});

test("session queue coalesces catalog-approved transient events", () => {
  const queue = new ProtocolSessionQueue();
  queue.enqueueLive({
    ...event(1),
    durability: "transient",
    type: "usage.subscription.updated",
    data: { provider: "one", value: 1 },
  });
  queue.enqueueLive({
    ...event(2),
    durability: "transient",
    type: "usage.subscription.updated",
    data: { provider: "one", value: 2 },
  });
  assert.equal(queue.coalesceTransientOverflow(1), 1);
  assert.deepEqual(queue.shiftTransient(1)[0]?.data, {
    provider: "one",
    value: 2,
  });
});

test("client heartbeat watchdog closes a silent session", async () => {
  const runtime = new ManualRuntime();
  const disconnected: Error[] = [];
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    send: () => undefined,
    clock: runtime,
    timers: runtime,
    onDisconnect: (error) => disconnected.push(error),
  });
  await client.start();
  await client.receive(
    serverMessages("welcome", {
      sessionId: "session_heartbeat",
      acceptingPeer: server,
      acceptedVersion: 1,
      capabilities: [],
      encoding: "json",
      streams: [],
      limits,
      heartbeat: { intervalMs: 10, timeoutMs: 30 },
      resume: { accepted: false, mode: "fresh" },
    }) as never,
  );
  runtime.advance(40);
  assert.equal(client.state, "closed");
  assert.match(disconnected[0]?.message ?? "", /heartbeat timed out/);
});

test("correlated close errors reject RPC and close the client session", async () => {
  const outbound: NerveMessage[] = [];
  const disconnected: Error[] = [];
  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    send: (message) => outbound.push(message),
    onDisconnect: (error) => disconnected.push(error),
  });
  await client.start();
  await client.receive(welcome("session_close_error"));
  const request = client.request(
    "applicationLog.prune",
    {},
    { idempotencyKey: "prune_close" },
  );
  const rejected = assert.rejects(request, /server is restarting/);
  const requestMessage = outbound.find((message) => message.kind === "request");
  assert.ok(requestMessage);
  await client.receive(
    serverMessages(
      "error",
      {
        code: "SERVICE_UNAVAILABLE",
        message: "server is restarting",
        retryable: true,
        close: true,
      },
      { replyTo: requestMessage.id, correlationId: requestMessage.id },
    ) as ProtocolV1Message,
  );
  await rejected;
  assert.equal(client.state, "closed");
  assert.equal(disconnected.length, 1);
});

test("transient sequence gaps do not count as unacked durable events", async () => {
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [{ stream: "local", latestSeq: 101 }],
    limits: { ...limits, maxUnackedDurableEvents: 1 },
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_transient_gap",
    send: () => undefined,
  });
  await readyServer(host, "session_transient_gap");
  await host.publish("local", event(100));
  await host.publish("local", {
    ...event(101),
    durability: "transient",
    type: "usage.subscription.updated",
    data: { provider: "test" },
  });
  assert.equal(host.state, "ready");
  await host.shutdown();
});

test("server emits flow state and closes on durable queue overflow", async () => {
  const outbound: NerveMessage[] = [];
  let releaseFirst: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let blockLiveBatch = false;
  let blockedOnce = false;
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [{ stream: "local", latestSeq: 3 }],
    limits: { ...limits, maxUnackedDurableEvents: 1 },
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_overflow",
    send: async (message) => {
      outbound.push(message);
      if (blockLiveBatch && !blockedOnce && message.kind === "event.batch") {
        blockedOnce = true;
        await blocked;
      }
    },
  });
  await readyServer(host, "session_overflow");
  outbound.length = 0;
  blockLiveBatch = true;
  const first = host.publish("local", event(1));
  await Promise.resolve();
  await host.publish("local", event(2));
  const overflow = host.publish("local", event(3));
  await Promise.resolve();
  releaseFirst?.();
  await Promise.all([first, overflow]);

  assert.equal(host.state, "closed");
  assert.ok(outbound.some((message) => message.kind === "flow.update"));
  assert.ok(outbound.some((message) => message.kind === "goodbye"));
});

test("server closes connections that never finish the handshake", async () => {
  const runtime = new ManualRuntime();
  const outbound: NerveMessage[] = [];
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [],
    limits,
    heartbeat: { intervalMs: 10, timeoutMs: 30 },
    sessionId: () => "session_handshake_timeout",
    send: (message) => outbound.push(message),
    clock: runtime,
    timers: runtime,
  });
  runtime.advance(30);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(host.state, "closed");
  assert.equal(outbound[0]?.kind, "goodbye");
});

test("server heartbeat watchdog shuts down a silent peer", async () => {
  const runtime = new ManualRuntime();
  const outbound: NerveMessage[] = [];
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [],
    limits,
    heartbeat: { intervalMs: 10, timeoutMs: 30 },
    sessionId: () => "session_server_heartbeat",
    send: (message) => outbound.push(message),
    clock: runtime,
    timers: runtime,
  });
  await readyServer(host, "session_server_heartbeat");
  runtime.advance(40);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(host.state, "closed");
  assert.equal(outbound.at(-1)?.kind, "goodbye");
});

test("server rejects stale sessions and ACKs beyond sent progress", async () => {
  const outbound: NerveMessage[] = [];
  const host = new ProtocolServerSession({
    acceptingPeer: server,
    createMessage: serverMessages,
    streams: () => [{ stream: "local", latestSeq: 1 }],
    limits,
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    sessionId: () => "session_bound",
    send: (message) => outbound.push(message),
  });
  await readyServer(host, "session_bound");
  await host.publish("local", event(1));
  await host.receive(
    clientMessages("event.ack", {
      sessionId: "session_bound",
      ackId: "ack_ahead",
      streams: [{ stream: "local", processedSeq: 2 }],
    }) as never,
  );
  assert.equal(host.state, "closed");
  assert.equal(outbound.at(-1)?.kind, "error");
});

test("client connection reconnects after a terminal peer message", async () => {
  const runtime = new ManualRuntime();
  const transports: ManualTransport[] = [];
  const connection = createClientConnection(runtime, transports);
  await connection.start();
  await transports[0]?.emit(welcome("session_terminal_one"));
  await transports[0]?.emit(
    serverMessages("goodbye", {
      sessionId: "session_terminal_one",
      reason: "server_shutdown",
    }) as ProtocolV1Message,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  runtime.advance(5);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(transports.length, 2);
  await transports[1]?.emit(welcome("session_terminal_two"));
  assert.equal(connection.state, "ready");
  await connection.close();
});

test("client connection recovers when the initial hello send fails", async () => {
  const runtime = new ManualRuntime();
  const transports: ManualTransport[] = [];
  const connection = createClientConnection(runtime, transports, true);
  await connection.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  runtime.advance(5);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(transports.length, 2);
  await transports[1]?.emit(welcome("session_after_send_failure"));
  assert.equal(connection.state, "ready");
  await connection.close();
});

test("client connection reconnects and retries only idempotent pending RPC", async () => {
  const runtime = new ManualRuntime();
  const transports: ManualTransport[] = [];
  const connection = new ProtocolClientConnection({
    transport: {
      connect: () => {
        const transport = new ManualTransport();
        transports.push(transport);
        return Promise.resolve(transport);
      },
    },
    reconnect: new ReconnectPolicy({
      initialDelayMs: 5,
      maximumDelayMs: 5,
      jitter: 0,
      maximumAttempts: 2,
    }),
    timers: runtime,
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: clientMessages,
        send,
        onDisconnect,
        timers: runtime,
        clock: runtime,
      }),
  });

  await connection.start();
  await transports[0]?.emit(welcome("session_one"));
  assert.equal(connection.state, "ready");
  const retryable = connection.request(
    "applicationLog.prune",
    {},
    { idempotencyKey: "prune_once" },
  );
  const firstRequest = transports[0]?.messages
    .map(decode)
    .find((message) => message.kind === "request");
  assert.ok(firstRequest);

  transports[0]?.remoteClose(1006, "network_lost");
  await new Promise<void>((resolve) => setImmediate(resolve));
  runtime.advance(5);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(transports.length, 2);
  await transports[1]?.emit(welcome("session_two"));
  const retriedRequest = transports[1]?.messages
    .map(decode)
    .find((message) => message.kind === "request");
  assert.equal(retriedRequest?.id, firstRequest.id);
  await transports[1]?.emit(
    serverMessages(
      "response",
      {
        ok: true,
        method: "applicationLog.prune",
        result: { pruned: 1, remaining: 0 },
      },
      { replyTo: firstRequest.id, correlationId: firstRequest.id },
    ) as ProtocolV1Message,
  );
  assert.deepEqual(await retryable, { pruned: 1, remaining: 0 });

  const nonRetryable = connection.request("settings.get", {});
  const rejected = assert.rejects(
    nonRetryable,
    /closed|disconnected|network_lost/i,
  );
  transports[1]?.remoteClose(1006, "network_lost_again");
  await rejected;
  await connection.close();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function buildEventBatchForTest(
  eventValue: ReturnType<typeof event>,
  stream: string,
  reason: "live" | "replay",
  previousDurableSeq: number,
) {
  return buildEventBatch([eventValue], {
    stream,
    reason,
    previousDurableSeq,
  });
}

function replayComplete(replayId: string): ProtocolV1Message {
  return serverMessages("replay.complete", {
    sessionId: "session_overlapping_replay",
    replayId,
    streams: [
      {
        stream: "local",
        fromSeq: 1,
        toSeq: 1,
        latestSeq: 1,
        durableCompleteThroughSeq: 1,
        sentEvents: 1,
        sentDurableEvents: 1,
        sentTransientEvents: 0,
      },
    ],
    liveDelivery: "resuming",
  }) as ProtocolV1Message;
}

function createClientConnection(
  runtime: ManualRuntime,
  transports: ManualTransport[],
  failFirstSend = false,
): ProtocolClientConnection {
  return new ProtocolClientConnection({
    transport: {
      connect: () => {
        const transport = new ManualTransport(
          failFirstSend && transports.length === 0,
        );
        transports.push(transport);
        return Promise.resolve(transport);
      },
    },
    reconnect: new ReconnectPolicy({
      initialDelayMs: 5,
      maximumDelayMs: 5,
      jitter: 0,
      maximumAttempts: 2,
    }),
    timers: runtime,
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: clientMessages,
        send,
        onDisconnect,
        timers: runtime,
        clock: runtime,
      }),
  });
}

function event(seq: number) {
  return {
    seq,
    id: `evt_lifecycle_${seq}`,
    ts: new Date().toISOString(),
    type: "project.created",
    durability: "durable" as const,
    data: {},
  };
}

async function readyServer(
  host: ProtocolServerSession,
  sessionId: string,
): Promise<void> {
  await host.receive(
    clientMessages("hello", {
      requestedVersion: 1,
      capabilities: [],
      encodings: ["json"],
    }) as never,
  );
  await host.receive(clientMessages("ready", { sessionId }) as never);
}

function welcome(sessionId: string): ProtocolV1Message {
  return serverMessages("welcome", {
    sessionId,
    acceptingPeer: server,
    acceptedVersion: 1,
    capabilities: [],
    encoding: "json",
    streams: [],
    limits,
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    resume: { accepted: true, mode: "live" },
  }) as ProtocolV1Message;
}

const codec = new ProtocolCodec();
function decode(frame: string): ProtocolV1Message {
  return codec.decode(frame);
}
