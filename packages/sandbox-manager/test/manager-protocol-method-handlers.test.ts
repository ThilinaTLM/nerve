import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ManagerState } from "../src/app/manager-state.js";
import { HttpError } from "../src/http/errors.js";
import { handleManagerProtocolMethod } from "../src/protocol/manager-protocol-method-handlers.js";
import type { SandboxWsServer } from "../src/protocol/sandbox-ws-server.js";

const record = {
  sandboxId: "sbx_1",
  backend: "docker",
  image: { reference: "nerve-sandbox:dev", sandboxSpec: "v1" },
  desiredState: "running",
  observedState: "running",
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
  it("returns a manager-derived sandbox snapshot when disconnected", async () => {
    const result = await handleManagerProtocolMethod(
      context(),
      "sandbox.snapshot.get",
      { sandboxId: "sbx_1" },
    );
    assert.equal((result as { sandboxId?: string }).sandboxId, "sbx_1");
    assert.equal((result as { connected?: boolean }).connected, false);
    assert.equal((result as { stale?: boolean }).stale, true);
  });

  it("forwards connected prompt commands with command id idempotency", async () => {
    const sent: Array<{ method: string; params: unknown; requestId: string }> =
      [];
    const ctx = context({
      session: {
        socket: {},
        forwarder: {
          send: async (
            _socket: unknown,
            method: string,
            params: unknown,
            requestId: string,
          ) => {
            sent.push({ method, params, requestId });
            return {
              accepted: true,
              commandId: requestId,
              status: "running",
              conversationId: "conv_1",
              agentId: "agent_1",
              runId: "run_1",
            };
          },
        },
      },
    });
    const result = await handleManagerProtocolMethod(
      ctx,
      "sandbox.agent.prompt",
      {
        sandboxId: "sbx_1",
        commandId: "cmd_1",
        conversationId: "conv_1",
        agentId: "agent_1",
        prompt: "hello",
      },
    );
    assert.equal((result as { commandId?: string }).commandId, "cmd_1");
    assert.deepEqual(sent, [
      {
        method: "sandbox.run.start",
        params: {
          commandId: "cmd_1",
          conversationId: "conv_1",
          agentId: "agent_1",
          prompt: "hello",
        },
        requestId: "cmd_1",
      },
    ]);
  });

  it("reconstructs the conversation transcript from durable events when disconnected", async () => {
    const result = (await handleManagerProtocolMethod(
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
    const result = (await handleManagerProtocolMethod(
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
      () => handleManagerProtocolMethod(context(), "sandbox.nope", {}),
      (error) =>
        error instanceof HttpError && error.code === "METHOD_NOT_FOUND",
    );
    await assert.rejects(
      () =>
        handleManagerProtocolMethod(context(), "sandbox.agent.prompt", {
          sandboxId: "sbx_1",
          commandId: "cmd_1",
          prompt: "hello",
        }),
      (error) =>
        error instanceof HttpError && error.code === "SERVICE_UNAVAILABLE",
    );
  });
});

function context(options: { session?: unknown; events?: unknown[] } = {}) {
  const idempotency = new Map<string, { hash: string; value: unknown }>();
  return {
    state: {
      sandboxes: {
        get: async (sandboxId: string) =>
          sandboxId === "sbx_1" ? record : undefined,
      },
      sessions: { get: async () => undefined },
      events: { list: async () => options.events ?? [] },
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
