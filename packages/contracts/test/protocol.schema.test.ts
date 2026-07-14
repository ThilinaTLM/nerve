import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ackMessageSchema,
  allOperationDefinitions,
  allPublicEventDefinitions,
  boundedPublicJsonSchema,
  boundedPublicObjectSchema,
  type EventBatchData,
  type EventEnvelope,
  eventBatchDataSchema,
  eventBatchMessageSchema,
  exploreResultPreviewSchema,
  flowUpdateMessageSchema,
  helloMessageSchema,
  nerveMessageSchema,
  protocolErrorMessageSchema,
  operationDefinition,
  operationNameSchema,
  operationParamsSchema,
  operationResultSchema,
  parseOperationParams,
  parseOperationResult,
  parsePublicEventBatch,
  parsePublicEventEnvelope,
  parseProtocolRequestData,
  parseProtocolResponseData,
  replayCompleteMessageSchema,
  replayRequestMessageSchema,
  snapshotCursorSchema,
  validatePublicEvent,
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
    source: { role: "ui", id: "ui_test" },
    target: { role: "workbench_server", id: "server_test" },
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
    stream: "local",
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

describe("compact explore payloads", () => {
  it("accepts compact result previews without full report fields", () => {
    const parsed = exploreResultPreviewSchema.parse({
      reports: [
        {
          agentId: "agent_02H00000000000000000000000",
          task: "Inspect the tool output boundary",
          status: "completed",
          reportPath: "/tmp/explore/report.md",
          summaryPreview: "Boundary summary",
        },
      ],
    });

    assert.equal(parsed.reports[0]?.reportPath, "/tmp/explore/report.md");
    assert.equal(parsed.reports[0]?.summaryPreview, "Boundary summary");
  });

  it("projects full result reports to compact preview metadata", () => {
    const parsed = exploreResultPreviewSchema.parse({
      reports: [
        {
          agentId: "agent_02H00000000000000000000000",
          task: "Inspect the tool output boundary",
          status: "completed",
          report: "full report text",
          steps: [{ type: "assistant", message: "full report received" }],
          reportPath: "/tmp/explore/report.md",
          summaryPreview: "Boundary summary",
        },
      ],
    }) as { reports: Array<Record<string, unknown>> };

    assert.equal(parsed.reports[0]?.report, undefined);
    assert.equal(parsed.reports[0]?.steps, undefined);
    assert.equal(parsed.reports[0]?.reportPath, "/tmp/explore/report.md");
    assert.equal(parsed.reports[0]?.summaryPreview, "Boundary summary");
  });

  it("strips legacy full report fields from completion events", () => {
    const parsed = validatePublicEvent(
      "agent.explore_completed",
      {
        parentAgentId: "agent_01H00000000000000000000000",
        reports: [
          {
            agentId: "agent_02H00000000000000000000000",
            task: "Inspect the tool output boundary",
            status: "completed",
            report: "legacy full report text",
            steps: [{ type: "assistant", message: "legacy detail" }],
            reportPath: "/tmp/explore/report.md",
            summaryPreview: "Boundary summary",
          },
        ],
      },
      "workbench_server",
    ) as { reports: Array<Record<string, unknown>> };

    assert.equal(parsed.reports[0]?.report, undefined);
    assert.equal(parsed.reports[0]?.steps, undefined);
    assert.equal(parsed.reports[0]?.reportPath, "/tmp/explore/report.md");
  });
});

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
      requestedVersion: 1,
      capabilities: [
        "encoding.json",
        "event.batch",
        "event.replay",
        "event.ack.processed",
      ],
      encodings: ["json"],
      resume: { streams: [{ stream: "local", processedSeq: 10 }] },
    });
    assert.equal(helloMessageSchema.safeParse(hello).success, true);

    const welcome = message("welcome", {
      sessionId: "ses_test",
      acceptingPeer: { role: "workbench_server", id: "server_test" },
      acceptedVersion: 1,
      capabilities: [
        "encoding.json",
        "event.batch",
        "event.replay",
        "event.ack.processed",
      ],
      encoding: "json",
      streams: [
        { stream: "local", latestSeq: 12, durableSeq: 11, replayFromSeq: 10 },
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

  it("validates snapshot cursors and operation catalog params", () => {
    assert.equal(
      snapshotCursorSchema.safeParse({
        streams: [{ stream: "local", processedSeq: 12 }],
      }).success,
      true,
    );
    assert.equal(
      snapshotCursorSchema.safeParse({
        streams: [{ stream: "local", processedSeq: -1 }],
      }).success,
      false,
    );
    assert.equal(
      operationNameSchema.safeParse("snapshot.workspace.get").success,
      true,
    );
    assert.equal(
      operationParamsSchema("approval.grant").safeParse({
        approvalId: "approval_test",
        note: "ok",
      }).success,
      true,
    );
    assert.equal(
      operationParamsSchema("git.file.stage").safeParse({
        projectId: "proj_test",
        repo: ".",
        path: "src/index.ts",
      }).success,
      true,
    );
    assert.equal(
      operationParamsSchema("project.conversations.prune").safeParse({
        projectId: "proj_test",
        strategy: "keepLatest",
        keepLatest: 10,
      }).success,
      true,
    );
    assert.equal(
      operationResultSchema("approval.grant").safeParse({
        toolCall: { not: "a tool call" },
      }).success,
      false,
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
        cursor: { streams: [{ stream: "local", processedSeq: 0 }] },
        generatedAt: ts,
      }).success,
      true,
    );
  });

  it("dispatches HTTP and RPC payloads through catalog schemas", () => {
    assert.deepEqual(
      parseOperationParams("project.get", { projectId: "proj_1" }),
      {
        projectId: "proj_1",
      },
    );
    assert.throws(() => parseOperationParams("project.get", {}));
    assert.deepEqual(
      parseProtocolRequestData({
        method: "project.get",
        params: { projectId: "proj_1" },
      }),
      { method: "project.get", params: { projectId: "proj_1" } },
    );
    assert.deepEqual(parseOperationResult("project.delete", { ok: true }), {
      ok: true,
    });
    assert.throws(() => parseOperationResult("project.delete", { ok: false }));
    assert.deepEqual(
      parseProtocolResponseData("project.delete", {
        ok: true,
        method: "project.delete",
        result: { ok: true },
      }).result,
      { ok: true },
    );
    assert.throws(() =>
      parseProtocolResponseData("project.get", {
        ok: true,
        method: "project.delete",
        result: { ok: true },
      }),
    );
  });

  it("owns every operation once with explicit routing metadata", () => {
    const definitions = allOperationDefinitions();
    assert.equal(
      new Set(definitions.map((definition) => definition.method)).size,
      definitions.length,
    );
    for (const definition of definitions) {
      assert.ok(definition.requiredCapability.startsWith("operation."));
      assert.ok(definition.allowedTargetRoles.length > 0);
      assert.ok(
        ["read", "mutation", "accepted_async"].includes(definition.kind),
      );
      assert.ok(
        ["none", "recommended", "required"].includes(definition.idempotency),
      );
      assert.equal(operationDefinition(definition.method), definition);
      assert.equal(
        definition.paramsSchema.safeParse(Symbol("params")).success,
        false,
      );
      assert.equal(
        definition.resultSchema.safeParse(Symbol("result")).success,
        false,
      );
    }

    for (const retired of [
      "agent.prompt",
      "agent.abort",
      "agent.continueFromFailure",
      "sandbox.agent.prompt",
      "sandbox.agent.abort",
      "sandbox.agent.continue",
      "sandbox.agent.configure",
      "sandbox.toolCall.get",
      "sandbox.run.start",
      "sandbox.input.submit",
    ]) {
      assert.equal(
        operationNameSchema.safeParse(retired).success,
        false,
        retired,
      );
    }
  });

  it("validates public envelopes and batches against catalog metadata", () => {
    const event = {
      seq: 1,
      id: "evt_git_1",
      ts,
      type: "git.repository.changed",
      durability: "durable",
      data: { repo: ".", reason: "commit" },
    };
    assert.equal(
      parsePublicEventEnvelope(event, "workbench_server").type,
      "git.repository.changed",
    );
    assert.throws(
      () => parsePublicEventEnvelope(event, "sandbox_manager"),
      /cannot be emitted/,
    );
    assert.throws(
      () =>
        parsePublicEventEnvelope(
          { ...event, durability: "transient" },
          "workbench_server",
        ),
      /must use durable/,
    );
    const batch = {
      stream: "local",
      batchId: "batch_1",
      reason: "live",
      events: [event],
      range: {
        firstSeq: 1,
        lastSeq: 1,
        durableFirstSeq: 1,
        durableLastSeq: 1,
        durableCount: 1,
        transientCount: 0,
        previousDurableSeq: 0,
        durableCompleteThroughSeq: 1,
      },
    };
    assert.equal(
      parsePublicEventBatch(batch, "workbench_server").events.length,
      1,
    );
  });

  it("owns every public event with concrete bounded metadata", () => {
    const definitions = allPublicEventDefinitions();
    assert.equal(
      new Set(definitions.map((definition) => definition.name)).size,
      definitions.length,
    );
    for (const definition of definitions) {
      assert.ok(definition.allowedSourceRoles.length > 0);
      assert.ok(["durable", "transient"].includes(definition.durability));
      assert.ok(Array.isArray(definition.scope));
      assert.notEqual(definition.payloadSchema, boundedPublicObjectSchema);
      assert.equal(
        definition.payloadSchema.safeParse(Symbol("payload")).success,
        false,
      );
      assert.equal(definition.allowedSourceRoles.includes("ui"), false);
      if (definition.coalescing) assert.ok(definition.scope.length > 0);
    }
    assert.equal(
      boundedPublicJsonSchema.safeParse({ authorization_token: "secret" })
        .success,
      false,
    );
    assert.equal(
      boundedPublicJsonSchema.safeParse({
        endpoint: "https://user:password@example.test",
      }).success,
      false,
    );
    assert.throws(
      () =>
        validatePublicEvent(
          "settings.updated",
          { authorization_token: "secret" },
          "workbench_server",
        ),
      /secret-like/,
    );
    assert.throws(
      () =>
        validatePublicEvent(
          "sandbox.lifecycle.changed",
          {
            sandboxId: "sbx_1",
            current: "ready",
            changedAt: ts,
          },
          "sandbox_agent",
        ),
      /cannot be emitted/,
    );
    for (const retired of [
      "manager.sandbox.created",
      "manager.sandbox.updated",
      "approval.requested",
      "approval.granted",
      "approval.denied",
      "userQuestion.requested",
      "userQuestion.resolved",
      "run.waiting_for_input",
      "run.waiting_for_approval",
      "run.waiting_for_plan_review",
    ]) {
      assert.throws(
        () => validatePublicEvent(retired, {}, "sandbox_manager"),
        /Unknown public event/,
        retired,
      );
    }
  });

  it("validates replay, ack, flow, and error messages", () => {
    assert.equal(
      ackMessageSchema.safeParse(
        message("event.ack", {
          sessionId: "ses_test",
          ackId: "ack_test",
          streams: [{ stream: "local", processedSeq: 1 }],
          received: [{ stream: "local", highestSeq: 2 }],
        }),
      ).success,
      true,
    );

    assert.equal(
      replayRequestMessageSchema.safeParse(
        message("replay.request", {
          sessionId: "ses_test",
          replayId: "rpl_test",
          streams: [{ stream: "local", fromSeq: 1 }],
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
              stream: "local",
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
          scope: { stream: "local" },
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
