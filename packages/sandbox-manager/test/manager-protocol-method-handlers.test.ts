import {
  allOperationDefinitions,
  type NerveMessage,
  operationNameSchema,
  type ProtocolRequestData,
} from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
          earliestAvailableSeq: (options.events ?? []).length
            ? Math.min(
                ...(options.events ?? []).map((event) =>
                  Number((event as { seq?: number }).seq ?? 0),
                ),
              )
            : 1,
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
function transcriptEvents() {
  return [
    {
      sandboxId: "sbx_1",
      id: "evt_1",
      seq: 20,
      type: "run.transcript.appended",
      ts: "2026-07-05T21:23:17.212Z",
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
