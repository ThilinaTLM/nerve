import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  type NerveMessage,
  type ProtocolV1Message,
} from "@nervekit/contracts/wire";
import { createMessageFactory, type ProtocolTimers } from "../../src/index.js";
import { ProtocolServerSession } from "../../src/server.js";

class FakeTimers implements ProtocolTimers {
  readonly intervals: Array<() => void> = [];
  setTimeout(): unknown {
    return Symbol("timeout");
  }
  clearTimeout(): void {}
  setInterval(callback: () => void): unknown {
    this.intervals.push(callback);
    return callback;
  }
  clearInterval(): void {}
  tickIntervals(): void {
    this.intervals.forEach((callback) => callback());
  }
}

describe("server heartbeat validation", () => {
  it("does not let invalid peers refresh an established session", async () => {
    let now = 0;
    const timers = new FakeTimers();
    const outbound: ProtocolV1Message[] = [];
    const serverMessages = createMessageFactory({
      source: { role: "workbench_server", id: "server_test" },
      target: { role: "ui", id: "ui_test" },
    });
    const clientMessages = createMessageFactory({
      source: { role: "ui", id: "ui_test" },
      target: { role: "workbench_server", id: "server_test" },
    });
    const server = new ProtocolServerSession({
      acceptingPeer: { role: "workbench_server", id: "server_test" },
      createMessage: serverMessages,
      capabilities: [STREAM_SUBSCRIPTION_CAPABILITY],
      limits: {
        maxMessageBytes: 1_000_000,
        maxBatchEvents: 100,
        maxBatchBytes: 1_000_000,
      },
      heartbeat: { intervalMs: 100, timeoutMs: 100 },
      sessionId: () => "session_test",
      send: (message: NerveMessage) =>
        outbound.push(message as ProtocolV1Message),
      clock: {
        now: () => now,
        isoNow: () => "2026-01-01T00:00:00.000Z",
      },
      timers,
    });

    await server.receive(
      clientMessages("hello", {
        requestedVersion: 1,
        capabilities: [STREAM_SUBSCRIPTION_CAPABILITY],
        requiredCapabilities: [STREAM_SUBSCRIPTION_CAPABILITY],
        encodings: ["json"],
      }) as ProtocolV1Message,
    );
    await server.receive(
      clientMessages("ready", {
        sessionId: "session_test",
      }) as ProtocolV1Message,
    );
    assert.equal(server.state, "ready");

    now = 50;
    const attackerMessages = createMessageFactory({
      source: { role: "ui", id: "attacker" },
      target: { role: "workbench_server", id: "server_test" },
    });
    await server.receive(
      attackerMessages("heartbeat", {
        sessionId: "session_test",
        sentAt: "2026-01-01T00:00:00.000Z",
      }) as ProtocolV1Message,
    );

    now = 101;
    timers.tickIntervals();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(server.state, "closed");
  });
});
