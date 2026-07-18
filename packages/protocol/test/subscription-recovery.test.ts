import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  type EventEnvelope,
  type NerveMessage,
  type NotifyEvent,
  type ProtocolV1Message,
  type StreamState,
} from "@nervekit/contracts";
import {
  ProtocolClientSession,
  ProtocolServerSession,
  createMessageFactory,
} from "../src/index.js";

const ts = "2026-07-18T00:00:00.000Z";
const capabilities = [
  "encoding.json",
  "event.batch",
  "event.notify",
  STREAM_SUBSCRIPTION_CAPABILITY,
];

class MemoryStreams {
  readonly streams = new Map<string, EventEnvelope[]>();
  readonly floors = new Map<string, number>();

  append(
    stream: string,
    type = "project.created",
    data: unknown = {},
  ): EventEnvelope {
    const events = this.streams.get(stream) ?? [];
    const envelope: EventEnvelope = {
      seq: (events.at(-1)?.seq ?? 0) + 1,
      id: `evt_${stream.replaceAll("/", "_")}_${events.length + 1}`,
      ts,
      type,
      data,
    };
    events.push(envelope);
    this.streams.set(stream, events);
    return envelope;
  }

  state(stream: string): StreamState {
    const events = this.streams.get(stream) ?? [];
    const latestSeq = events.at(-1)?.seq ?? 0;
    return {
      stream,
      latestSeq,
      earliestAvailableSeq:
        latestSeq === 0 ? 0 : (this.floors.get(stream) ?? events[0]?.seq ?? 1),
    };
  }

  truncateBelow(stream: string, seq: number): void {
    this.floors.set(stream, seq);
    this.streams.set(
      stream,
      (this.streams.get(stream) ?? []).filter((event) => event.seq >= seq),
    );
  }
}

type Pair = ReturnType<typeof createPair>;

function createPair(
  logs: MemoryStreams,
  options: {
    apply?: (
      stream: string,
      event: EventEnvelope<Record<string, unknown>>,
    ) => void | Promise<void>;
    notify?: (events: readonly NotifyEvent[]) => void;
    snapshot?: (stream: string) => void;
    unavailable?: (stream: string) => void;
    close?: (code: number, reason: string) => void;
    maxBufferedEvents?: number;
    knownStreams?: readonly string[];
  } = {},
) {
  const clientOutbound: ProtocolV1Message[] = [];
  const serverOutbound: ProtocolV1Message[] = [];
  const clientMessages = createMessageFactory({
    source: { role: "ui", id: "ui_test" },
    target: { role: "workbench_server", id: "server_test" },
  });
  const serverMessages = createMessageFactory({
    source: { role: "workbench_server", id: "server_test" },
    target: { role: "ui", id: "ui_test" },
  });

  const server = new ProtocolServerSession({
    acceptingPeer: { role: "workbench_server", id: "server_test" },
    createMessage: serverMessages,
    capabilities,
    limits: {
      maxMessageBytes: 1_000_000,
      maxBatchEvents: 2,
      maxBatchBytes: 1_000_000,
    },
    heartbeat: { intervalMs: 60_000, timeoutMs: 120_000 },
    sessionId: () => "session_test",
    send: async (message: NerveMessage) => {
      serverOutbound.push(message as ProtocolV1Message);
      await client.receive(message as ProtocolV1Message);
    },
    close: options.close,
    maxBufferedEvents: options.maxBufferedEvents,
    subscriptions: {
      resolve(cursors) {
        const known = options.knownStreams;
        return {
          accepted: true,
          streams: cursors
            .filter((cursor) => !known || known.includes(cursor.stream))
            .map((cursor) => logs.state(cursor.stream)),
        };
      },
    },
    readStream(stream, fromSeq, limit) {
      return {
        ...logs.state(stream),
        events: (logs.streams.get(stream) ?? [])
          .filter((event) => event.seq >= fromSeq)
          .slice(0, limit),
      };
    },
  });

  const client = new ProtocolClientSession({
    createMessage: clientMessages,
    capabilities,
    send: async (message: NerveMessage) => {
      clientOutbound.push(message as ProtocolV1Message);
      await server.receive(message as ProtocolV1Message);
    },
    applyEvent: options.apply,
    onNotify: (events) => options.notify?.(events),
    onSnapshotRequired: (stream) => options.snapshot?.(stream),
    onStreamUnavailable: (stream) => options.unavailable?.(stream),
  });

  return { client, server, clientOutbound, serverOutbound };
}

async function start(pair: Pair): Promise<void> {
  await pair.client.start();
  assert.equal(pair.client.state, "ready");
  assert.equal(pair.server.state, "ready");
}

describe("subscription-only replay and recovery", () => {
  it("orders replay before live for each stream", async () => {
    const logs = new MemoryStreams();
    logs.append("workspace");
    logs.append("workspace");
    const applied: number[] = [];
    const pair = createPair(logs, {
      apply: (_stream, event) => applied.push(event.seq),
    });
    await start(pair);

    const updated = await pair.client.subscribe([
      { stream: "workspace", processedSeq: 0 },
    ]);
    assert.equal(updated.streams[0]?.mode, "replay");
    assert.deepEqual(applied, [1, 2]);

    const live = logs.append("workspace");
    await pair.server.publish("workspace", live);
    await pair.server.flush();
    assert.deepEqual(applied, [1, 2, 3]);
    assert.deepEqual(pair.client.currentCursors(), [
      { stream: "workspace", processedSeq: 3 },
    ]);
  });

  it("degrades unknown streams to unavailable without silencing the rest", async () => {
    const logs = new MemoryStreams();
    logs.append("workspace");
    const applied: Array<{ stream: string; seq: number }> = [];
    const unavailable: string[] = [];
    const pair = createPair(logs, {
      apply: (stream, event) => applied.push({ stream, seq: event.seq }),
      unavailable: (stream) => unavailable.push(stream),
      knownStreams: ["workspace"],
    });
    await start(pair);

    const updated = await pair.client.subscribe([
      { stream: "workspace", processedSeq: 0 },
      { stream: "conv/conv_gone", processedSeq: 7 },
    ]);
    assert.equal(updated.accepted, true);
    const modes = new Map(
      updated.streams.map((stream) => [stream.stream, stream.mode]),
    );
    assert.equal(modes.get("workspace"), "replay");
    assert.equal(modes.get("conv/conv_gone"), "unavailable");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.deepEqual(unavailable, ["conv/conv_gone"]);

    const live = logs.append("workspace");
    await pair.server.publish("workspace", live);
    await pair.server.flush();
    assert.equal(
      applied.some(
        (entry) => entry.stream === "workspace" && entry.seq === live.seq,
      ),
      true,
    );
    assert.deepEqual(pair.client.currentCursors(), [
      { stream: "workspace", processedSeq: live.seq },
    ]);
  });

  it("resumes exactly after a reconnect cursor", async () => {
    const logs = new MemoryStreams();
    logs.append("workspace");
    logs.append("workspace");
    logs.append("workspace");
    const applied: number[] = [];
    const pair = createPair(logs, {
      apply: (_stream, event) => applied.push(event.seq),
    });
    await start(pair);
    await pair.client.subscribe([{ stream: "workspace", processedSeq: 1 }]);
    assert.deepEqual(applied, [2, 3]);
  });

  it("reports snapshot_required independently per retained stream", async () => {
    const logs = new MemoryStreams();
    for (let index = 0; index < 5; index += 1) logs.append("workspace");
    logs.truncateBelow("workspace", 4);
    const snapshots: string[] = [];
    const pair = createPair(logs, {
      snapshot: (stream) => snapshots.push(stream),
    });
    await start(pair);
    const updated = await pair.client.subscribe([
      { stream: "workspace", processedSeq: 1 },
    ]);
    assert.equal(updated.streams[0]?.mode, "snapshot_required");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.deepEqual(snapshots, ["workspace"]);
  });

  it("atomically swaps conversation subscriptions", async () => {
    const logs = new MemoryStreams();
    logs.append("workspace");
    logs.append("conv/conv_one", "conversation.entry.appended", {
      conversationId: "conv_one",
    });
    logs.append("conv/conv_two", "conversation.entry.appended", {
      conversationId: "conv_two",
    });
    const applied: string[] = [];
    const pair = createPair(logs, { apply: (stream) => applied.push(stream) });
    await start(pair);
    await pair.client.subscribe([
      { stream: "workspace", processedSeq: 1 },
      { stream: "conv/conv_one", processedSeq: 1 },
    ]);
    await pair.client.subscribe([
      { stream: "workspace", processedSeq: 1 },
      { stream: "conv/conv_two", processedSeq: 1 },
    ]);

    await pair.server.publish("conv/conv_one", logs.append("conv/conv_one"));
    await pair.server.publish("conv/conv_two", logs.append("conv/conv_two"));
    await pair.server.flush();
    assert.deepEqual(applied, ["conv/conv_two"]);
  });

  it("automatically resubscribes after a defensive gap", async () => {
    const logs = new MemoryStreams();
    const pair = createPair(logs);
    await start(pair);
    await pair.client.subscribe([{ stream: "workspace", processedSeq: 0 }]);
    const before = pair.clientOutbound.filter(
      (message) => message.kind === "stream.subscription.set",
    ).length;
    await pair.client.receive({
      ...pair.serverOutbound[0],
      id: "msg_gap",
      kind: "event.batch",
      data: {
        stream: "workspace",
        batchId: "batch_gap",
        reason: "live",
        events: [
          { seq: 2, id: "evt_gap", ts, type: "project.created", data: {} },
        ],
        firstSeq: 2,
        lastSeq: 2,
      },
    } as ProtocolV1Message);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const after = pair.clientOutbound.filter(
      (message) => message.kind === "stream.subscription.set",
    ).length;
    assert.equal(after, before + 1);
  });

  it("delivers notify events without changing cursors and coalesces latest scope", async () => {
    const logs = new MemoryStreams();
    const received: NotifyEvent[][] = [];
    const pair = createPair(logs, {
      notify: (events) => received.push([...events]),
    });
    await start(pair);
    await pair.client.subscribe([{ stream: "workspace", processedSeq: 0 }]);
    void pair.server.notify({
      id: "evt_notify_1",
      ts,
      type: "usage.subscription.updated",
      data: { provider: "one" },
    });
    void pair.server.notify({
      id: "evt_notify_2",
      ts,
      type: "usage.subscription.updated",
      data: { provider: "one" },
    });
    await pair.server.flush();
    assert.equal(received.flat().length, 1);
    assert.equal(received.flat()[0]?.id, "evt_notify_2");
    assert.deepEqual(pair.client.currentCursors(), [
      { stream: "workspace", processedSeq: 0 },
    ]);
  });

  it("closes with resync_required when the outgoing buffer overflows", async () => {
    const logs = new MemoryStreams();
    const closes: Array<[number, string]> = [];
    const pair = createPair(logs, {
      maxBufferedEvents: 1,
      close: (code, reason) => closes.push([code, reason]),
    });
    await start(pair);
    await pair.client.subscribe([{ stream: "workspace", processedSeq: 0 }]);
    void pair.server.publish("workspace", logs.append("workspace"));
    void pair.server.publish("workspace", logs.append("workspace"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(closes, [[1013, "resync_required"]]);
  });
});
