import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allOperationDefinitions,
  type NerveMessage,
  operationNameSchema,
  type ProtocolRequestData,
} from "@nervekit/contracts";
import type { ManagerState } from "../src/app/manager-state.js";
import { HttpError } from "../src/http/errors.js";
import { createManagerOperationHandlers } from "../src/protocol/manager-protocol-method-handlers.js";
import type { SandboxWsServer } from "../src/protocol/sandbox-ws-server.js";

const record = {
  sandboxId: "sbx_1",
  backend: "docker",
  image: { reference: "nerve-sandbox-agent:dev", sandboxSpec: "v1" },
  desiredState: "running",
  observedState: "running",
  lifecycleState: "ready",
  lifecycleUpdatedAt: "2026-06-26T12:00:00.000Z",
  workspaceRef: {
    kind: "bind",
    source: "/tmp/workspace",
    target: "/workspace",
  },
  stateRef: { kind: "bind", source: "/tmp/state", target: "/state" },
  instanceId: "inst_1",
  createdAt: "2026-06-26T12:00:00.000Z",
  updatedAt: "2026-06-26T12:00:00.000Z",
};

describe("manager protocol method handlers", () => {
  it("registers every manager-target operation", () => {
    const handlers = createManagerOperationHandlers(context());
    for (const definition of allOperationDefinitions()) {
      if (!definition.allowedTargetRoles.includes("sandbox_manager")) continue;
      assert.equal(
        typeof handlers[definition.method],
        "function",
        definition.method,
      );
    }
  });
  it("returns a snapshot-consistent manager recovery cursor", async () => {
    const result = (await invokeManagerOperation(
      context({
        events: [
          {
            sandboxId: "__manager__",
            id: "evt_manager_7",
            seq: 7,
            type: "sandbox.lifecycle.changed",
            durability: "durable",
            payload: {},
          },
        ],
      }),
      "sandbox.manager.recovery.get",
      {},
    )) as {
      stateEpoch: string;
      cursors: Array<{ stream: string; processedSeq: number }>;
    };
    assert.equal(result.stateEpoch, "protocol-v1");
    assert.deepEqual(result.cursors, [{ stream: "manager", processedSeq: 7 }]);
  });

  it("returns a manager-derived sandbox snapshot when disconnected", async () => {
    const result = await invokeManagerOperation(
      context(),
      "sandbox.snapshot.get",
      { sandboxId: "sbx_1" },
    );
    assert.equal((result as { sandboxId?: string }).sandboxId, "sbx_1");
    assert.equal((result as { connected?: boolean }).connected, false);
    assert.equal((result as { stale?: boolean }).stale, true);
  });

  it("marks stopped containers offline in manager-derived snapshots", async () => {
    const result = (await invokeManagerOperation(
      context({
        record: {
          ...record,
          desiredState: "stopped",
          observedState: "exited",
          lifecycleState: "stopped",
          stoppedAt: "2026-06-26T12:05:00.000Z",
          containerRef: { kind: "docker", id: "c1", name: "nerve-sbx_1" },
        },
        driverStatus: {
          state: "exited",
          exitCode: 0,
          finishedAt: "2026-06-26T12:05:00.000Z",
        },
      }),
      "sandbox.snapshot.get",
      { sandboxId: "sbx_1" },
    )) as {
      status?: string;
      staleness?: { reason?: string };
      container?: { state?: string; exitCode?: number };
      limitations?: string[];
    };
    assert.equal(result.status, "offline");
    assert.equal(result.staleness?.reason, "container_stopped");
    assert.equal(result.container?.state, "exited");
    assert.equal(result.container?.exitCode, 0);
    assert.match(result.limitations?.[0] ?? "", /read-only snapshots/);
  });

  it("forwards canonical host operations unchanged using the target id", async () => {
    const sent: Array<{
      method: string;
      params: unknown;
      requestId: string;
      lineage: unknown;
    }> = [];
    const ctx = context({
      session: {
        socket: {},
        forwarder: {
          send: async (
            _socket: unknown,
            method: string,
            params: unknown,
            requestId: string,
            _timeoutMs: number,
            lineage: unknown,
          ) => {
            sent.push({ method, params, requestId, lineage });
            return { tasks: [] };
          },
        },
      },
      target: { role: "sandbox_agent", id: "sbx_1" },
      idempotencyKey: "request_1",
    });
    const result = await invokeManagerOperation(ctx, "task.list", {});
    assert.deepEqual(result, { tasks: [] });
    assert.deepEqual(sent, [
      {
        method: "task.list",
        params: {},
        requestId: "request_1",
        lineage: {
          correlationId: "correlation_test",
          causationId: "msg_test",
          traceId: "trace_test",
        },
      },
    ]);
  });

  it("reconstructs the conversation transcript from durable events when disconnected", async () => {
    const result = (await invokeManagerOperation(
      context({ events: transcriptEvents() }),
      "sandbox.conversation.snapshot.get",
      { sandboxId: "sbx_1", conversationId: "conv_1", agentId: "agent_main" },
    )) as {
      connected: boolean;
      stale: boolean;
      snapshot?: { entries: Array<{ role: string; text: string }> };
    };
    assert.equal(result.connected, false);
    assert.equal(result.stale, true);
    assert.equal(result.snapshot?.entries.length, 2);
    assert.deepEqual(
      result.snapshot?.entries.map((entry) => [entry.role, entry.text]),
      [
        ["user", "Hello from curl"],
        ["assistant", "Hello!"],
      ],
    );
  });

  it("merges sparse tool-call lifecycle updates when projecting durable events", async () => {
    const result = (await invokeManagerOperation(
      context({ events: toolCallProjectionEvents() }),
      "sandbox.conversation.snapshot.get",
      { sandboxId: "sbx_1", conversationId: "conv_1", agentId: "agent_main" },
    )) as {
      snapshot?: {
        toolCalls: Array<{
          status: string;
          argsPreview?: unknown;
          resultPreview?: unknown;
        }>;
      };
    };
    const toolCall = result.snapshot?.toolCalls[0];
    assert.equal(toolCall?.status, "completed");
    assert.deepEqual(toolCall?.argsPreview, { command: "git --help" });
    assert.deepEqual(toolCall?.resultPreview, {
      content: [{ type: "text", text: "usage: git\n" }],
      details: { exitCode: 0 },
    });
  });

  it("preserves transcript entry details when projecting durable events", async () => {
    const result = (await invokeManagerOperation(
      context({ events: transcriptEventsWithDetails() }),
      "sandbox.conversation.snapshot.get",
      { sandboxId: "sbx_1", conversationId: "conv_1", agentId: "agent_main" },
    )) as {
      snapshot?: { entries: Array<{ text: string; details?: unknown }> };
    };
    assert.deepEqual(result.snapshot?.entries.at(-1)?.details, {
      thinkingBlocks: [{ text: "I should inspect first." }],
    });
  });

  it("keeps prior messages when projecting a conversation snapshot for a specific run", async () => {
    const result = (await invokeManagerOperation(
      context({ events: multiRunTranscriptEvents() }),
      "sandbox.conversation.snapshot.get",
      {
        sandboxId: "sbx_1",
        conversationId: "conv_1",
        agentId: "agent_main",
        runId: "run_2",
      },
    )) as {
      snapshot?: { entries: Array<{ role: string; text: string }> };
    };
    assert.deepEqual(
      result.snapshot?.entries.map((entry) => [entry.role, entry.text]),
      [
        ["user", "First"],
        ["assistant", "First response"],
        ["user", "Second"],
        ["assistant", "Second response"],
      ],
    );
  });

  it("degrades to the durable-event transcript when a connected controller is unresponsive", async () => {
    const ctx = context({
      events: transcriptEvents(),
      session: {
        socket: {},
        forwarder: {
          send: async () => {
            throw new Error("Sandbox command timed out: req_1");
          },
        },
      },
    });
    const result = (await invokeManagerOperation(
      ctx,
      "sandbox.conversation.snapshot.get",
      { sandboxId: "sbx_1", conversationId: "conv_1" },
    )) as {
      connected: boolean;
      stale: boolean;
      snapshot?: { entries: unknown[] };
    };
    assert.equal(result.connected, true);
    assert.equal(result.stale, true);
    assert.equal(result.snapshot?.entries.length, 2);
  });

  it("rejects unknown methods and unavailable sandboxes", async () => {
    await assert.rejects(
      () => invokeManagerOperation(context(), "sandbox.nope", {}),
      (error) =>
        error instanceof HttpError && error.code === "METHOD_NOT_FOUND",
    );
    await assert.rejects(
      () =>
        invokeManagerOperation(
          context({ target: { role: "sandbox_agent", id: "sbx_1" } }),
          "task.list",
          {},
        ),
      (error) =>
        error instanceof HttpError && error.code === "SERVICE_UNAVAILABLE",
    );
  });
});

async function invokeManagerOperation(
  ctx: ReturnType<typeof context>,
  methodInput: string,
  params: unknown,
): Promise<unknown> {
  const parsedMethod = operationNameSchema.safeParse(methodInput);
  if (!parsedMethod.success)
    throw new HttpError(404, "Method not found", "METHOD_NOT_FOUND");
  const handler = createManagerOperationHandlers(ctx)[parsedMethod.data];
  if (!handler)
    throw new HttpError(404, "Method not found", "METHOD_NOT_FOUND");
  const request: NerveMessage<ProtocolRequestData> = {
    protocol: "nerve",
    version: 1,
    id: "msg_test",
    kind: "request",
    correlationId: "correlation_test",
    traceId: "trace_test",
    ts: "2026-06-26T12:00:00.000Z",
    source: { role: "ui", id: "ui_test" },
    target: ctx.target,
    data: {
      method: parsedMethod.data,
      params,
      idempotencyKey: ctx.idempotencyKey,
    },
  };
  return handler(params as never, request);
}

function context(
  options: {
    session?: unknown;
    events?: unknown[];
    record?: typeof record;
    driverStatus?: { state: string; exitCode?: number; finishedAt?: string };
    target?:
      | { role: "sandbox_manager" }
      | { role: "sandbox_agent"; id: string };
    idempotencyKey?: string;
  } = {},
) {
  const idempotency = new Map<string, { hash: string; value: unknown }>();
  const sandboxRecord = options.record ?? record;
  return {
    state: {
      sandboxes: {
        get: async (sandboxId: string) =>
          sandboxId === "sbx_1" ? sandboxRecord : undefined,
        list: async () => [sandboxRecord],
        put: async () => undefined,
      },
      driver: {
        inspect: async (ref: unknown) => ({
          ref,
          state: options.driverStatus?.state ?? sandboxRecord.observedState,
          exitCode: options.driverStatus?.exitCode,
          finishedAt: options.driverStatus?.finishedAt,
        }),
      },
      activity: { get: () => undefined },
      sessions: { get: async () => undefined },
      events: {
        list: async () => options.events ?? [],
        streamState: async () => ({
          latestSeq: Math.max(
            0,
            ...(options.events ?? []).map((event) =>
              Number((event as { seq?: number }).seq ?? 0),
            ),
          ),
          durableSeq: Math.max(
            0,
            ...(options.events ?? [])
              .filter(
                (event) =>
                  (event as { durability?: string }).durability !== "transient",
              )
              .map((event) => Number((event as { seq?: number }).seq ?? 0)),
          ),
        }),
      },
      logger: { debug: () => undefined },
      idempotency: {
        get: async (key: string) => idempotency.get(key),
        put: async (key: string, hash: string, value: unknown) => {
          idempotency.set(key, { hash, value });
        },
      },
    } as unknown as ManagerState,
    controller: {
      getSession: () => options.session,
    } as unknown as SandboxWsServer,
    target: options.target ?? { role: "sandbox_manager" },
    idempotencyKey: options.idempotencyKey,
  };
}

function toolCallProjectionEvents() {
  return [
    transcriptEvent(
      "evt_tool_entry_1",
      1,
      "run_1",
      "user",
      "!git --help",
      "2026-07-05T21:23:16.000Z",
    ),
    toolCallUpdateEvent(2, "running", { command: "git --help" }),
    toolCallUpdateEvent(3, "completed", undefined, {
      content: [{ type: "text", text: "usage: git\n" }],
      details: { exitCode: 0 },
    }),
  ];
}

function toolCallUpdateEvent(
  seq: number,
  status: "running" | "completed",
  argsPreview?: unknown,
  resultPreview?: unknown,
) {
  return {
    sandboxId: "sbx_1",
    id: `evt_tool_${seq}`,
    seq,
    type: "toolCall.updated",
    ts: `2026-07-05T21:23:1${seq}.000Z`,
    durability: "durable",
    payload: {
      conversationId: "conv_1",
      agentId: "agent_main",
      projectId: "proj_1",
      runId: "run_1",
      providerToolCallId: "call_bash_1",
      toolCall: {
        id: "tool_bash_1",
        sourceToolCallId: "call_bash_1",
        providerToolCallId: "call_bash_1",
        conversationId: "conv_1",
        agentId: "agent_main",
        projectId: "proj_1",
        runId: "run_1",
        toolName: "bash",
        risk: "command",
        cwd: "/tmp/workspace",
        status,
        argsPreview,
        resultPreview,
        createdAt: `2026-07-05T21:23:1${seq}.000Z`,
        updatedAt: `2026-07-05T21:23:1${seq}.000Z`,
      },
    },
  };
}

function transcriptEventsWithDetails() {
  return [
    transcriptEvent(
      "evt_details_1",
      1,
      "run_1",
      "assistant",
      "Done.",
      "2026-07-05T21:23:17.000Z",
      { thinkingBlocks: [{ text: "I should inspect first." }] },
    ),
  ];
}

function multiRunTranscriptEvents() {
  return [
    transcriptEvent(
      "evt_1",
      1,
      "run_1",
      "user",
      "First",
      "2026-07-05T21:23:17.000Z",
    ),
    transcriptEvent(
      "evt_2",
      2,
      "run_1",
      "assistant",
      "First response",
      "2026-07-05T21:23:18.000Z",
    ),
    transcriptEvent(
      "evt_3",
      3,
      "run_2",
      "user",
      "Second",
      "2026-07-05T21:24:17.000Z",
    ),
    transcriptEvent(
      "evt_4",
      4,
      "run_2",
      "assistant",
      "Second response",
      "2026-07-05T21:24:18.000Z",
    ),
  ];
}

function transcriptEvent(
  id: string,
  seq: number,
  runId: string,
  role: "user" | "assistant",
  text: string,
  ts: string,
  details?: unknown,
) {
  return {
    sandboxId: "sbx_1",
    id,
    seq,
    type: "run.transcript.appended",
    ts,
    durability: "durable",
    payload: {
      role,
      index: seq,
      runId,
      agentId: "agent_main",
      content: { text },
      details,
      entryId: `entry_${seq}`,
      createdAt: ts,
      conversationId: "conv_1",
    },
  };
}

function transcriptEvents() {
  return [
    {
      sandboxId: "sbx_1",
      id: "evt_1",
      seq: 20,
      type: "run.transcript.appended",
      ts: "2026-07-05T21:23:17.212Z",
      durability: "durable",
      payload: {
        role: "user",
        index: 0,
        runId: "run_1783286597212_11",
        agentId: "agent_main",
        content: { text: "Hello from curl" },
        entryId: "entry_1783286597222_0",
        createdAt: "2026-07-05T21:23:17.212Z",
        conversationId: "conv_1",
      },
    },
    {
      sandboxId: "sbx_1",
      id: "evt_2",
      seq: 21,
      type: "run.transcript.appended",
      ts: "2026-07-05T21:23:18.232Z",
      durability: "durable",
      payload: {
        role: "assistant",
        index: 6,
        runId: "run_1783286597212_11",
        agentId: "agent_main",
        content: { text: "Hello!", bytes: 6 },
        entryId: "entry_1783286598232_6",
        createdAt: "2026-07-05T21:23:18.232Z",
        conversationId: "conv_1",
      },
    },
  ];
}
