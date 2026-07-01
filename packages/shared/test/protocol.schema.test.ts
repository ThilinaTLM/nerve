import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ackMessageSchema,
  type EventBatchData,
  type EventEnvelope,
  eventBatchDataSchema,
  eventBatchMessageSchema,
  flowUpdateMessageSchema,
  helloMessageSchema,
  nerveMessageSchema,
  protocolErrorMessageSchema,
  protocolMethodNameSchema,
  protocolMethodParamsSchema,
  replayCompleteMessageSchema,
  replayRequestMessageSchema,
  snapshotCursorSchema,
  welcomeMessageSchema,
  workspaceSnapshotResponseSchema,
} from "../src/index.js";

const ts = "2026-06-26T12:00:00.000Z";

function message(kind: string, data: unknown) {
  return {
    protocol: "nerve",
    version: 1,
    id: `msg_${kind.replaceAll(".", "_")}`,
    kind,
    ts,
    data,
  };
}

function event(
  seq: number,
  durability: "durable" | "transient" = "durable",
): EventEnvelope {
  return {
    seq,
    id: `evt_${seq}`,
    ts,
    type:
      durability === "durable" ? "project.created" : "conversation.live.delta",
    durability,
    data: {},
  };
}

function batch(overrides: Partial<EventBatchData> = {}): EventBatchData {
  return {
    stream: "global",
    batchId: "bat_test",
    reason: "live",
    events: [event(1), event(2, "transient")],
    range: {
      firstSeq: 1,
      lastSeq: 2,
      durableFirstSeq: 1,
      durableLastSeq: 1,
      durableCount: 1,
      transientCount: 1,
      previousDurableSeq: 0,
      durableCompleteThroughSeq: 1,
    },
    ...overrides,
  };
}

describe("Protocol v1 shared schemas", () => {
  it("validates baseline message envelope", () => {
    assert.equal(
      nerveMessageSchema.safeParse(message("heartbeat", {})).success,
      true,
    );
    assert.equal(
      nerveMessageSchema.safeParse({
        ...message("heartbeat", {}),
        protocol: "other",
      }).success,
      false,
    );
    assert.equal(
      nerveMessageSchema.safeParse({ ...message("heartbeat", {}), version: 2 })
        .success,
      false,
    );
  });

  it("validates session hello and welcome messages", () => {
    const hello = message("hello", {
      role: "ui",
      client: { id: "cli_test", instanceId: "tab_test", name: "Nerve Web UI" },
      requestedVersion: 1,
      capabilities: [
        "encoding.json",
        "event.batch",
        "event.replay",
        "event.ack.processed",
      ],
      encodings: ["json"],
      resume: { streams: [{ stream: "global", processedSeq: 10 }] },
    });
    assert.equal(helloMessageSchema.safeParse(hello).success, true);

    const welcome = message("welcome", {
      sessionId: "ses_test",
      orchestrator: { id: "orc_test", version: "0.5.0", startedAt: ts },
      acceptedVersion: 1,
      capabilities: [
        "encoding.json",
        "event.batch",
        "event.replay",
        "event.ack.processed",
      ],
      encoding: "json",
      streams: [
        { stream: "global", latestSeq: 12, durableSeq: 11, replayFromSeq: 10 },
      ],
      limits: {
        maxMessageBytes: 4_194_304,
        maxBatchEvents: 500,
        maxBatchBytes: 1_048_576,
        maxInflightBatches: 8,
        maxUnackedDurableEvents: 5_000,
      },
      heartbeat: { intervalMs: 30_000, timeoutMs: 70_000 },
      resume: { accepted: true, mode: "replay" },
    });
    assert.equal(welcomeMessageSchema.safeParse(welcome).success, true);
  });

  it("validates event batches and rejects inconsistent ranges", () => {
    assert.equal(
      eventBatchMessageSchema.safeParse(message("event.batch", batch()))
        .success,
      true,
    );
    assert.equal(
      eventBatchDataSchema.safeParse(
        batch({ range: { ...batch().range, durableCount: 2 } }),
      ).success,
      false,
    );
    assert.equal(
      eventBatchDataSchema.safeParse(
        batch({
          events: [event(2), event(1)],
          range: { ...batch().range, firstSeq: 2, lastSeq: 1 },
        }),
      ).success,
      false,
    );
    assert.equal(
      eventBatchDataSchema.safeParse(
        batch({ range: { ...batch().range, previousDurableSeq: undefined } }),
      ).success,
      false,
    );
  });

  it("validates snapshot cursors and method registry params", () => {
    assert.equal(
      snapshotCursorSchema.safeParse({
        streams: [{ stream: "global", processedSeq: 12 }],
      }).success,
      true,
    );
    assert.equal(
      snapshotCursorSchema.safeParse({
        streams: [{ stream: "global", processedSeq: -1 }],
      }).success,
      false,
    );
    assert.equal(
      protocolMethodNameSchema.safeParse("snapshot.workspace.get").success,
      true,
    );
    assert.equal(
      protocolMethodParamsSchema("approval.grant").safeParse({
        approvalId: "approval_test",
        note: "ok",
      }).success,
      true,
    );
    assert.equal(
      workspaceSnapshotResponseSchema.safeParse({
        snapshot: {
          projects: [],
          conversations: [],
          agents: [],
          tasks: [],
          approvals: [],
          userQuestions: [],
          planReviews: [],
        },
        cursor: { streams: [{ stream: "global", processedSeq: 0 }] },
      }).success,
      true,
    );
  });

  it("validates replay, ack, flow, and error messages", () => {
    assert.equal(
      ackMessageSchema.safeParse(
        message("ack", {
          sessionId: "ses_test",
          ackId: "ack_test",
          streams: [{ stream: "global", processedSeq: 1 }],
          received: [{ stream: "global", highestSeq: 2 }],
        }),
      ).success,
      true,
    );

    assert.equal(
      replayRequestMessageSchema.safeParse(
        message("replay.request", {
          sessionId: "ses_test",
          replayId: "rpl_test",
          streams: [{ stream: "global", fromSeq: 1 }],
          reason: "gap_detected",
        }),
      ).success,
      true,
    );

    assert.equal(
      replayCompleteMessageSchema.safeParse(
        message("replay.complete", {
          sessionId: "ses_test",
          replayId: "rpl_test",
          streams: [
            {
              stream: "global",
              fromSeq: 1,
              toSeq: 2,
              latestSeq: 2,
              durableCompleteThroughSeq: 2,
              sentEvents: 1,
              sentDurableEvents: 1,
              sentTransientEvents: 0,
            },
          ],
          liveDelivery: "resuming",
        }),
      ).success,
      true,
    );

    assert.equal(
      flowUpdateMessageSchema.safeParse(
        message("flow.update", {
          sessionId: "ses_test",
          scope: { stream: "global" },
          mode: "degraded",
          reason: "client_backpressure",
        }),
      ).success,
      true,
    );

    assert.equal(
      protocolErrorMessageSchema.safeParse(
        message("error", {
          code: "INVALID_MESSAGE",
          message: "Invalid message",
          retryable: false,
        }),
      ).success,
      true,
    );
  });
});
