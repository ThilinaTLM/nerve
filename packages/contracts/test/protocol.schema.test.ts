import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allOperationDefinitions,
  allPublicEventDefinitions,
  assertTransition,
  boundedPublicJsonSchema,
  boundedPublicObjectSchema,
  canTransition,
  conversationStream,
  eventBatchDataSchema,
  eventBatchMessageSchema,
  liveMessageTransitions,
  operationDefinition,
  parseConversationStream,
  parseOperationParams,
  parseOperationResult,
  parseProtocolRequestData,
  parseProtocolResponseData,
  parsePublicEventBatch,
  parsePublicEventEnvelope,
  streamForEvent,
  streamSubscriptionSetMessageSchema,
  streamSubscriptionUpdatedMessageSchema,
  TERMINAL_TOOL_STATUSES,
  toolCallTransitions,
  turnTransitions,
  validatePublicEvent,
  WORKSPACE_STREAM,
  type EventBatchData,
  type EventEnvelope,
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

function event(seq: number): EventEnvelope {
  return {
    seq,
    id: `evt_${seq}`,
    ts,
    type: "project.created",
    data: {},
  };
}

function batch(overrides: Partial<EventBatchData> = {}): EventBatchData {
  return {
    stream: WORKSPACE_STREAM,
    batchId: "bat_test",
    reason: "live",
    events: [event(1), event(2)],
    firstSeq: 1,
    lastSeq: 2,
    ...overrides,
  };
}

describe("compact explore payloads", () => {
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
  });
});

describe("Protocol v1 shared schemas", () => {
  it("validates exact-set subscriptions with per-stream modes", () => {
    const set = message("stream.subscription.set", {
      sessionId: "ses_test",
      subscriptionId: "sub_test",
      streams: [
        { stream: WORKSPACE_STREAM, processedSeq: 4 },
        { stream: "conv/conv_one", processedSeq: 2 },
      ],
    });
    assert.equal(
      streamSubscriptionSetMessageSchema.safeParse(set).success,
      true,
    );
    assert.equal(
      streamSubscriptionSetMessageSchema.safeParse({
        ...set,
        data: {
          ...set.data,
          streams: [
            { stream: WORKSPACE_STREAM, processedSeq: 4 },
            { stream: WORKSPACE_STREAM, processedSeq: 2 },
          ],
        },
      }).success,
      false,
    );

    assert.equal(
      streamSubscriptionUpdatedMessageSchema.safeParse(
        message("stream.subscription.updated", {
          sessionId: "ses_test",
          subscriptionId: "sub_test",
          accepted: true,
          streams: [
            {
              stream: WORKSPACE_STREAM,
              latestSeq: 8,
              earliestAvailableSeq: 3,
              mode: "replay",
            },
            {
              stream: "conv/conv_one",
              latestSeq: 9,
              earliestAvailableSeq: 5,
              mode: "snapshot_required",
            },
          ],
        }),
      ).success,
      true,
    );
  });

  it("enforces dense event batches", () => {
    assert.equal(
      eventBatchMessageSchema.safeParse(message("event.batch", batch()))
        .success,
      true,
    );
    assert.equal(
      eventBatchDataSchema.safeParse(
        batch({ events: [event(1), event(3)], lastSeq: 3 }),
      ).success,
      false,
    );
    assert.equal(
      eventBatchDataSchema.safeParse(batch({ firstSeq: 2 })).success,
      false,
    );
    assert.equal(
      eventBatchDataSchema.safeParse(
        batch({ events: [], firstSeq: null, lastSeq: null }),
      ).success,
      true,
    );
  });

  it("dispatches HTTP and RPC payloads through catalog schemas", () => {
    assert.deepEqual(
      parseOperationParams("project.get", { projectId: "proj_1" }),
      { projectId: "proj_1" },
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
      parseOperationParams("conversation.compaction.cancel", {
        conversationId: "conv_1",
      }),
      { conversationId: "conv_1" },
    );
    assert.deepEqual(
      parseOperationResult("conversation.compaction.cancel", { ok: true }),
      { ok: true },
    );
    assert.deepEqual(
      parseProtocolResponseData("project.delete", {
        ok: true,
        method: "project.delete",
        result: { ok: true },
      }).result,
      { ok: true },
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
  });

  it("validates public envelopes and sequenced batches against catalog metadata", () => {
    const publicEvent = {
      seq: 1,
      id: "evt_git_1",
      ts,
      type: "git.repository.changed",
      data: { repo: ".", reason: "commit" },
    };
    assert.equal(
      parsePublicEventEnvelope(publicEvent, "workbench_server").type,
      "git.repository.changed",
    );
    assert.throws(
      () => parsePublicEventEnvelope(publicEvent, "sandbox_manager"),
      /cannot be emitted/,
    );
    assert.throws(
      () =>
        parsePublicEventEnvelope(
          { ...publicEvent, type: "task.output" },
          "workbench_server",
        ),
      /cannot use event.batch/,
    );
    assert.equal(
      parsePublicEventBatch(
        {
          stream: WORKSPACE_STREAM,
          batchId: "batch_1",
          reason: "live",
          events: [publicEvent],
          firstSeq: 1,
          lastSeq: 1,
        },
        "workbench_server",
      ).events.length,
      1,
    );
  });

  it("owns every public event with delivery and bounded metadata", () => {
    const definitions = allPublicEventDefinitions();
    assert.equal(
      new Set(definitions.map((definition) => definition.name)).size,
      definitions.length,
    );
    const turnStarted = definitions.find(
      (definition) => definition.name === "conversation.live.turn.started",
    );
    assert.equal(turnStarted?.delivery, "sequenced");
    assert.equal(turnStarted?.supersedable, true);
    const liveDone = definitions.find(
      (definition) => definition.name === "conversation.live.content.done",
    );
    assert.equal(liveDone?.supersedable, true);
    const canonicalLifecycle = definitions.find(
      (definition) => definition.name === "conversation.compaction.started",
    );
    assert.equal(canonicalLifecycle?.supersedable, false);
    const compactionProgress = definitions.find(
      (definition) => definition.name === "conversation.compaction.progress",
    );
    assert.equal(compactionProgress?.delivery, "sequenced");
    assert.equal(compactionProgress?.supersedable, true);
    const delta = definitions.find(
      (definition) => definition.name === "conversation.live.content.delta",
    );
    assert.equal(delta?.supersedable, true);
    const sandboxActivity = definitions.find(
      (definition) => definition.name === "sandbox.activity.changed",
    );
    assert.equal(sandboxActivity?.delivery, "ephemeral");
    assert.equal(sandboxActivity?.coalescing, "latest_by_scope");
    for (const definition of definitions) {
      assert.ok(["sequenced", "ephemeral"].includes(definition.delivery));
      assert.equal(
        definition.payloadSchema.safeParse(Symbol("payload")).success,
        false,
      );
      assert.notEqual(definition.payloadSchema, boundedPublicObjectSchema);
      if (definition.delivery === "sequenced") {
        assert.doesNotThrow(() => streamForEvent(definition.name, {}));
      }
      if (definition.coalescing) {
        assert.equal(definition.delivery, "ephemeral");
        assert.ok(definition.scope.length > 0);
      }
    }
    assert.equal(
      boundedPublicJsonSchema.safeParse({ authorization_token: "secret" })
        .success,
      false,
    );
  });

  it("routes workspace and conversation streams", () => {
    assert.equal(streamForEvent("project.created", {}), WORKSPACE_STREAM);
    assert.equal(
      streamForEvent("conversation.deleted", { conversationId: "conv_1" }),
      WORKSPACE_STREAM,
    );
    assert.equal(
      streamForEvent("conversation.entry.appended", {
        conversationId: "conv_1",
      }),
      conversationStream("conv_1"),
    );
    assert.equal(parseConversationStream("conv/conv_1"), "conv_1");
    assert.equal(parseConversationStream(WORKSPACE_STREAM), null);
    assert.throws(
      () => streamForEvent("task.output", {}),
      /does not have a stream/,
    );
  });

  it("shares lifecycle transition guards", () => {
    assert.equal(
      canTransition(toolCallTransitions, "requested", "running"),
      true,
    );
    assert.equal(
      canTransition(toolCallTransitions, "completed", "running"),
      false,
    );
    assert.doesNotThrow(() =>
      assertTransition(
        liveMessageTransitions,
        "started",
        "completed",
        "message",
      ),
    );
    assert.throws(
      () => assertTransition(turnTransitions, "failed", "started", "turn"),
      /Illegal lifecycle transition/,
    );
    assert.deepEqual(TERMINAL_TOOL_STATUSES, ["completed", "denied", "error"]);
  });
});
