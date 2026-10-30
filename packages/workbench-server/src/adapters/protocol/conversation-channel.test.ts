import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type WebSocket from "ws";
import { createMessageFactory } from "@nervekit/protocol";
import { ProtocolClientSession } from "@nervekit/protocol/client";
import {
  conversationChannelOperations,
  type ConversationEvent,
} from "@nervekit/contracts/core";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  type ProtocolV1Message,
} from "@nervekit/contracts/wire";
import type { CoreChange } from "@nervekit/conversation-core";
import { createConversationProtocolSession } from "./conversation-channel.js";

const at = "2026-10-30T00:00:00.000Z";
function event(id: string): ConversationEvent {
  return {
    id: `evt_${id}`,
    conversationId: id,
    sequence: 1,
    previousEventId: null,
    turnId: null,
    inputId: null,
    createdAt: at,
    type: "user_message",
    llmRepresentation: "user",
    payload: {
      text: id,
      originalText: id,
      source: "user",
      senderConversationId: null,
      commandPreparation: null,
    },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(failure: "resolve" | "activation" | "replay" | "live") {
  const ready = deferred(),
    healthy = deferred(),
    closed = deferred();
  const applied: string[] = [],
    warnings: string[] = [],
    readFailures: string[] = [],
    closes: number[] = [];
  const reads = new Map<string, number>();
  let listener!: (change: CoreChange) => void;
  let liveEvent: ConversationEvent | undefined;
  class Socket extends EventEmitter {
    readyState = 1;
    failWrites = false;
    send(frame: string) {
      if (this.failWrites) throw new Error("transport write failed");
      const message = JSON.parse(frame) as ProtocolV1Message;
      queueMicrotask(() => {
        void client.receive(message);
      });
    }
    close(code: number) {
      this.readyState = 3;
      closes.push(code);
      closed.resolve();
    }
  }
  const socket = new Socket();
  const channel = createConversationProtocolSession(
    socket as unknown as WebSocket,
    {
      daemonId: "isolation-test",
      coreStorage: {
        conversations: {
          reportFailure: (id: string) => {
            readFailures.push(id);
          },
        },
      },
      operationContexts: { platform: {} },
      logger: {
        warn: async (message: string) => {
          warnings.push(message);
        },
      },
      agentConfiguration: {
        subscribeHealth: () => () => {},
        subscribeCreation: () => () => {},
      },
      conversationCore: {
        projects: { list: () => [] },
        subscribe: (callback: typeof listener) => {
          listener = callback;
          return () => {};
        },
        getSnapshot: (id: string) => ({
          conversation: { projectId: "p" },
          lastSequence:
            failure === "live" ? (liveEvent?.conversationId === id ? 1 : 0) : 1,
          compaction: null,
        }),
        getHistory: (id: string) => [event(id)],
        getEventsSince: (id: string, sequence: number) => {
          const count = (reads.get(id) ?? 0) + 1;
          reads.set(id, count);
          if (
            id === "bad" &&
            ((failure === "resolve" && count === 1) ||
              (failure === "activation" && count === 2) ||
              (failure === "replay" && count === 3))
          )
            throw new SyntaxError("corrupt event payload");
          if (failure === "live") return [];
          return sequence < 1 ? [event(id)] : [];
        },
      },
    } as unknown as Parameters<typeof createConversationProtocolSession>[1],
    () => {},
  );
  const client = new ProtocolClientSession({
    createMessage: createMessageFactory({
      source: { role: "ui", id: "test-ui" },
      target: { role: "workbench_server" },
    }),
    capabilities: [
      "encoding.json",
      "event.notify",
      STREAM_SUBSCRIPTION_CAPABILITY,
      ...conversationChannelOperations.map(
        (operation) => operation.requiredCapability,
      ),
    ],
    send: (message) => {
      socket.emit("message", JSON.stringify(message));
    },
    onReady: ready.resolve,
    applyEvent: (stream) => {
      applied.push(stream);
      if (stream === "conv/healthy") healthy.resolve();
    },
    rpcTimeoutMs: 1000,
  });
  await client.start();
  await ready.promise;
  return {
    client,
    socket,
    applied,
    warnings,
    readFailures,
    closes,
    healthy,
    closed,
    append: (value: ConversationEvent) => {
      liveEvent = value;
      listener({
        kind: "event_appended",
        conversationId: value.conversationId,
        event: value,
      });
    },
    corruptDelta: () =>
      listener({
        kind: "live",
        conversationId: "bad",
        delta: { type: "invalid" },
      } as unknown as CoreChange),
    dispose: () => {
      client.disconnect(new Error("test complete"));
      channel.dispose();
    },
  };
}

for (const failure of ["resolve", "activation", "replay"] as const) {
  void test(
    `conversation ${failure} decoding failure preserves the healthy stream and shared RPC connection`,
    { timeout: 5000 },
    async () => {
      const f = await fixture(failure);
      try {
        const subscription = await f.client.subscribe([
          { stream: "conv/bad", processedSeq: 0 },
          { stream: "conv/healthy", processedSeq: 0 },
        ]);
        if (failure === "resolve")
          assert.equal(
            subscription.streams.find((state) => state.stream === "conv/bad")
              ?.mode,
            "unavailable",
          );
        await f.healthy.promise;
        assert.deepEqual(f.applied, ["conv/healthy"]);
        assert.equal(
          (
            await f.client.request("conversation.getHistory", {
              conversationId: "healthy",
              limit: 10,
            })
          ).length,
          1,
        );
        assert.deepEqual(f.closes, []);
        assert.ok(f.warnings.includes("Conversation stream unavailable"));
        assert.deepEqual(f.readFailures, ["bad"]);
      } finally {
        f.dispose();
      }
    },
  );
}

for (const projection of ["payload", "envelope", "delta"] as const) {
  void test(
    `live ${projection} projection failures remove only the affected stream`,
    { timeout: 5000 },
    async () => {
      const f = await fixture("live");
      try {
        await f.client.subscribe([
          { stream: "conv/bad", processedSeq: 0 },
          { stream: "conv/healthy", processedSeq: 0 },
        ]);
        // An RPC queued after subscribe is a barrier for activation completion.
        await f.client.request("conversation.getHistory", {
          conversationId: "healthy",
          limit: 10,
        });
        if (projection === "delta") f.corruptDelta();
        else
          f.append(
            projection === "payload"
              ? ({ ...event("bad"), payload: {} } as ConversationEvent)
              : { ...event("bad"), id: "invalid-envelope-id" },
          );
        f.append(event("healthy"));
        await f.healthy.promise;
        assert.deepEqual(f.applied, ["conv/healthy"]);
        assert.equal(
          (
            await f.client.request("conversation.getHistory", {
              conversationId: "healthy",
              limit: 10,
            })
          ).length,
          1,
        );
        assert.deepEqual(f.closes, []);
        assert.ok(f.warnings.includes("Conversation stream unavailable"));
        assert.deepEqual(f.readFailures, ["bad"]);
      } finally {
        f.dispose();
      }
    },
  );
}

void test(
  "malformed protocol frames still close the connection",
  { timeout: 5000 },
  async () => {
    const f = await fixture("live");
    try {
      f.socket.emit("message", "{");
      await f.closed.promise;
      assert.deepEqual(f.closes, [1002]);
    } finally {
      f.dispose();
    }
  },
);

void test(
  "transport write failures remain connection-wide",
  { timeout: 5000 },
  async () => {
    const f = await fixture("live");
    try {
      await f.client.subscribe([{ stream: "conv/healthy", processedSeq: 0 }]);
      await f.client.request("conversation.getHistory", {
        conversationId: "healthy",
        limit: 10,
      });
      f.socket.failWrites = true;
      f.append(event("healthy"));
      await f.closed.promise;
      assert.deepEqual(f.closes, [1013]);
      assert.equal(
        f.warnings.includes("Conversation stream unavailable"),
        false,
      );
    } finally {
      f.dispose();
    }
  },
);
