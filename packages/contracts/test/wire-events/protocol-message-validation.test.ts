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
import { conversationLiveToolOutputStreamSchema } from "../../src/domains/conversations/index.js";
import {
  eventBatchDataSchema,
  eventBatchMessageSchema,
  parseProtocolRequestData,
  parseProtocolResponseData,
  streamSubscriptionSetMessageSchema,
  streamSubscriptionUpdatedMessageSchema,
  type EventBatchData,
} from "../../src/wire/index.js";

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

describe("run cancellation events", () => {
  it("requires the current project-scoped payload", () => {
    const current = {
      conversationId: "conv_test",
      agentId: "agent_test",
      runId: "run_test",
      projectId: "proj_test",
      cancelledAt: ts,
    };
    assert.deepEqual(
      validatePublicEvent("run.cancelled", current, "workbench_server"),
      current,
    );
    assert.throws(() =>
      validatePublicEvent(
        "run.cancelled",
        { ...current, projectId: undefined },
        "workbench_server",
      ),
    );
  });
});

describe("live tool output streams", () => {
  it("accepts model thinking and text channels", () => {
    for (const stream of ["thinking", "text"] as const) {
      assert.equal(
        conversationLiveToolOutputStreamSchema.safeParse(stream).success,
        true,
      );
    }
    assert.equal(
      conversationLiveToolOutputStreamSchema.safeParse("reasoning").success,
      false,
    );
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

describe("summary lifecycle event references", () => {
  it("keeps generated summary text out of public completion events", () => {
    const compacted = validatePublicEvent(
      "conversation.compacted",
      {
        conversationId: "conv_test",
        entryId: "entry_compaction",
        tokensBefore: 20_000,
        firstKeptEntryId: "entry_recent",
      },
      "workbench_server",
    ) as Record<string, unknown>;
    assert.equal(compacted.entryId, "entry_compaction");
    assert.equal(compacted.entry, undefined);

    assert.doesNotThrow(() =>
      validatePublicEvent(
        "conversation.branch_summarized",
        {
          conversationId: "conv_test",
          fromEntryId: "entry_old",
          targetEntryId: "entry_target",
          entryId: "entry_summary",
        },
        "workbench_server",
      ),
    );
    assert.doesNotThrow(() =>
      validatePublicEvent(
        "conversation.navigated",
        {
          conversationId: "conv_test",
          activeEntryId: "entry_summary",
          targetEntryId: "entry_target",
        },
        "workbench_server",
      ),
    );

    const oversizedEntry = {
      id: "entry_summary",
      conversationId: "conv_test",
      role: "system",
      kind: "branch_summary",
      text: "x".repeat(20_000),
      summary: "x".repeat(20_000),
      createdAt: ts,
    };
    assert.throws(() =>
      validatePublicEvent(
        "conversation.compacted",
        {
          conversationId: "conv_test",
          entry: oversizedEntry,
          tokensBefore: 20_000,
          firstKeptEntryId: "entry_recent",
        },
        "workbench_server",
      ),
    );
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
    const invalidation = {
      projectId: "proj_test",
      repo: ".",
      source: "filesystem",
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
      source: "filesystem",
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
        { projectId: "test", source: "filesystem" },
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
    assert.equal(turnStarted?.delivery, "ephemeral");
    assert.equal(turnStarted?.supersedable, false);
    const liveDone = definitions.find(
      (definition) => definition.name === "conversation.live.content.done",
    );
    assert.equal(liveDone?.delivery, "ephemeral");
    assert.equal(liveDone?.supersedable, false);
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
    assert.equal(delta?.delivery, "ephemeral");
    assert.deepEqual(delta?.coalescing, {
      strategy: "concat_delta",
      field: "delta",
      offsetField: "offset",
      maxChars: 16_384,
    });
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
