import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allOperationDefinitions,
  operationDefinition,
  parseOperationParams,
  parseOperationResult,
} from "../../src/operations/index.js";
import {
  allPublicEventDefinitions,
  assertTransition,
  boundedPublicJsonSchema,
  boundedPublicObjectSchema,
  canTransition,
  conversationStream,
  liveMessageTransitions,
  parseConversationStream,
  parsePublicEventBatch,
  parsePublicEventEnvelope,
  streamForEvent,
  TERMINAL_TOOL_STATUSES,
  toolCallTransitions,
  turnTransitions,
  validatePublicEvent,
  WORKSPACE_STREAM,
  type EventEnvelope,
} from "../../src/events/index.js";
import { toolOutputStreamSchema } from "../../src/domains/tools/index.js";
import {
  eventBatchDataSchema,
  eventBatchMessageSchema,
  parseProtocolRequestData,
  parseProtocolResponseData,
  streamSubscriptionSetMessageSchema,
  streamSubscriptionUpdatedMessageSchema,
  type EventBatchData,
} from "../../src/wire/index.js";

import { assistantEvent } from "./core-event-fixtures.js";

const ts = "2026-06-26T12:00:00.000Z";

describe("daemon lifecycle events", () => {
  it("validates daemon shutdown events from the workbench server", () => {
    const stopped = {
      daemonId: "daemon_test",
      signal: "SIGTERM",
    };
    assert.deepEqual(
      validatePublicEvent("daemon.stopped", stopped, "workbench_server"),
      stopped,
    );
    assert.throws(() =>
      validatePublicEvent(
        "daemon.stopped",
        { ...stopped, daemonId: "invalid" },
        "workbench_server",
      ),
    );
    assert.throws(() =>
      validatePublicEvent(
        "daemon.stopped",
        { ...stopped, signal: "" },
        "workbench_server",
      ),
    );
    assert.throws(() => validatePublicEvent("daemon.stopped", stopped, "ui"));
  });
});

describe("live tool output streams", () => {
  it("accepts model thinking and text channels", () => {
    for (const stream of ["thinking", "text"] as const) {
      assert.equal(toolOutputStreamSchema.safeParse(stream).success, true);
    }
    assert.equal(toolOutputStreamSchema.safeParse("reasoning").success, false);
  });
});

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
    type: "conversation.event",
    data: { ...assistantEvent(), sequence: seq },
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
    assert.equal(parseOperationResult("project.delete", null), null);
    assert.throws(() => parseOperationResult("project.delete", { ok: true }));
    assert.deepEqual(
      parseOperationParams("conversation.compact", {
        conversationId: "conv_1",
      }),
      { conversationId: "conv_1" },
    );
    assert.equal(parseOperationResult("conversation.compact", null), null);
    assert.equal(
      parseProtocolResponseData("project.delete", {
        ok: true,
        method: "project.delete",
        result: null,
      }).result,
      null,
    );
  });

  it("validates staged and unstaged Git file diff payloads", () => {
    assert.deepEqual(
      parseOperationParams("git.file.diff.get", {
        projectId: "proj_1",
        repo: ".",
        path: "src/file.ts",
        area: "staged",
      }),
      {
        projectId: "proj_1",
        repo: ".",
        path: "src/file.ts",
        area: "staged",
      },
    );
    assert.deepEqual(
      parseOperationResult("git.file.diff.get", {
        path: "src/file.ts",
        area: "unstaged",
        binary: false,
        original: "before\n",
        modified: "after\n",
      }),
      {
        path: "src/file.ts",
        area: "unstaged",
        binary: false,
        original: "before\n",
        modified: "after\n",
      },
    );
    assert.deepEqual(
      parseOperationResult("git.file.diff.get", {
        path: "image.png",
        area: "staged",
        binary: true,
      }),
      { path: "image.png", area: "staged", binary: true },
    );
    assert.throws(() =>
      parseOperationResult("git.file.diff.get", {
        path: "src/file.ts",
        area: "unstaged",
        binary: false,
        modified: "after\n",
      }),
    );
    assert.throws(() =>
      parseOperationParams("git.file.diff.get", {
        projectId: "proj_1",
        repo: ".",
        path: "src/file.ts",
        area: "working-tree",
      }),
    );
  });

  it("validates complete GitHub PR file diff payloads", () => {
    const params = {
      projectId: "proj_1",
      repo: ".",
      number: 99,
      path: "src/new.ts",
      previousPath: "src/old.ts",
      status: "renamed" as const,
      expectedBaseRefOid: "base1234",
      expectedHeadRepository: "example/repo",
      expectedHeadRefOid: "head1234",
    };
    assert.deepEqual(
      parseOperationParams("github.pr.file.diff.get", params),
      params,
    );
    assert.deepEqual(
      parseOperationResult("github.pr.file.diff.get", {
        kind: "text",
        path: "src/new.ts",
        previousPath: "src/old.ts",
        baseRefOid: "base1234",
        headRefOid: "head1234",
        original: "before\n",
        modified: "after\n",
      }),
      {
        kind: "text",
        path: "src/new.ts",
        previousPath: "src/old.ts",
        baseRefOid: "base1234",
        headRefOid: "head1234",
        original: "before\n",
        modified: "after\n",
      },
    );
    assert.throws(() =>
      parseOperationResult("github.pr.file.diff.get", {
        kind: "text",
        path: "src/new.ts",
        baseRefOid: "base1234",
        headRefOid: "head1234",
        modified: "after\n",
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
    const publicEvent = event(1);
    assert.equal(
      parsePublicEventEnvelope(publicEvent, "workbench_server").type,
      "conversation.event",
    );
    const invalidation = {
      projectId: "proj_test",
      repo: ".",
      generation: 1,
      fullRefreshRequired: false,
    };
    assert.deepEqual(
      validatePublicEvent(
        "git.repository.invalidated",
        invalidation,
        "workbench_server",
      ),
      invalidation,
    );
    const filesystemChange = {
      projectId: "proj_test",
      generation: 1,
      directories: ["", "src"],
      fullRefreshRequired: false,
    };
    assert.deepEqual(
      validatePublicEvent(
        "filesystem.project.changed",
        filesystemChange,
        "workbench_server",
      ),
      filesystemChange,
    );
    assert.throws(() =>
      validatePublicEvent(
        "filesystem.project.changed",
        {
          projectId: "test",
          generation: 1,
          directories: [],
          fullRefreshRequired: false,
        },
        "workbench_server",
      ),
    );
    assert.throws(
      () =>
        parsePublicEventEnvelope(
          {
            ...publicEvent,
            type: "git.repository.invalidated",
            data: invalidation,
          },
          "workbench_server",
        ),
      /cannot use event.batch/,
    );
    assert.throws(
      () =>
        parsePublicEventEnvelope(
          { ...publicEvent, type: "launch.output" },
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
    const durable = definitions.find(
      (definition) => definition.name === "conversation.event",
    );
    assert.equal(durable?.delivery, "sequenced");
    assert.equal(durable?.supersedable, false);
    const live = definitions.find(
      (definition) => definition.name === "conversation.live",
    );
    assert.equal(live?.delivery, "ephemeral");
    assert.equal(live?.supersedable, false);
    const head = definitions.find(
      (definition) => definition.name === "conversation.head",
    );
    assert.equal(head?.delivery, "ephemeral");
    assert.equal(head?.supersedable, true);
    assert.deepEqual(head?.coalescing, { strategy: "latest_by_scope" });
    for (const definition of definitions) {
      assert.ok(["sequenced", "ephemeral"].includes(definition.delivery));
      assert.equal(
        definition.payloadSchema.safeParse(Symbol("payload")).success,
        false,
      );
      assert.notEqual(definition.payloadSchema, boundedPublicObjectSchema);
      if (definition.delivery === "sequenced") {
        assert.doesNotThrow(() =>
          streamForEvent(definition.name, { conversationId: "conv_1" }),
        );
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
    assert.throws(
      () => streamForEvent("git.repository.changed", {}),
      /does not have a stream/,
    );
    assert.throws(
      () =>
        streamForEvent("conversation.deleted", { conversationId: "conv_1" }),
      /does not have a stream/,
    );
    assert.equal(
      streamForEvent("conversation.event", { conversationId: "conv_1" }),
      conversationStream("conv_1"),
    );
    assert.equal(parseConversationStream("conv/conv_1"), "conv_1");
    assert.equal(parseConversationStream(WORKSPACE_STREAM), null);
    assert.throws(
      () => streamForEvent("launch.output", {}),
      /does not have a stream/,
    );
  });

  it("shares lifecycle transition guards", () => {
    assert.equal(
      canTransition(toolCallTransitions, "committed", "running"),
      true,
    );
    assert.equal(
      canTransition(toolCallTransitions, "committed", "failed"),
      true,
      "startup recovery must be able to fail a committed tool call",
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
    assert.deepEqual(TERMINAL_TOOL_STATUSES, [
      "completed",
      "denied",
      "failed",
      "cancelled",
    ]);
  });
});
