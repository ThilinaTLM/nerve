import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentRecord, ToolCallRecord } from "@nervekit/contracts";
import { defaultSettings } from "@nervekit/contracts";
import { ToolService } from "../src/domains/tools/tool-service.js";
import { StreamLogRegistry } from "../src/infrastructure/events/stream-log-registry.js";
import { storagePaths } from "../src/infrastructure/storage/index.js";

describe("tool service lifecycle", () => {
  it("records pre-execution provider tool-call errors as terminal tool records", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-error-"));
    const events: Array<{ type: string; data: unknown }> = [];
    const testAgent = agent("autonomous");
    const service = new ToolService(
      {
        paths: storagePaths(home),
        settings: defaultSettings,
        localToken: "test",
      },
      {
        publish: async (type: string, data: unknown) =>
          events.push({ type, data }),
      } as never,
      { upsertToolCall: () => undefined } as never,
      {} as never,
      {
        runtimeForProject: async () => undefined,
        isAvailableForProject: async () => false,
        statusSnapshot: () => ({
          available: false,
          source: "unavailable",
          error: "not used",
        }),
        refresh: async () => ({
          available: false,
          source: "unavailable",
          error: "not used",
        }),
      } as never,
      async () => {
        throw new Error("not used");
      },
      () => testAgent,
      async () => {
        throw new Error("not used");
      },
      async () => undefined,
      {} as never,
      async () => testAgent,
      {} as never,
    );

    const toolCall = await service.recordProviderToolCallError(
      testAgent,
      "edit",
      {
        path: "src/file.ts",
        replacements: [{ oldText: "a", newText: "b", note: "bad" }],
      },
      "Validation failed for tool edit.",
      {
        providerToolCallId: "provider_call_1",
        sourceToolCallId: "provider_call_1",
        anchor: {
          runId: "run_01H00000000000000000000000",
          turnId: "turn_01H0000000000000000000000",
          liveMessageId: "msg_01H00000000000000000000000",
          contentIndex: 2,
          providerToolCallId: "provider_call_1",
        },
      },
    );

    assert.equal(toolCall.status, "error");
    assert.equal(toolCall.sourceToolCallId, "provider_call_1");
    assert.equal(toolCall.providerToolCallId, "provider_call_1");
    assert.equal(toolCall.error, "Validation failed for tool edit.");
    assert.deepEqual(toolCall.errorDetails, {
      code: "INVALID_TOOL_ARGUMENTS",
      message: "Validation failed for tool edit.",
    });
    assert.deepEqual(toolCall.args, {
      path: "src/file.ts",
      replacements: [{ oldText: "a", newText: "b", note: "bad" }],
    });
    // The resolved anchor must survive on the stored record: the transcript
    // renderer keys the tool's row by (liveMessageId, contentIndex).
    assert.equal(toolCall.runId, "run_01H00000000000000000000000");
    assert.equal(toolCall.turnId, "turn_01H0000000000000000000000");
    assert.equal(toolCall.liveMessageId, "msg_01H00000000000000000000000");
    assert.equal(toolCall.contentIndex, 2);
    assert.equal(
      service.findToolCallByProviderToolCallId("provider_call_1")?.id,
      toolCall.id,
    );
    const update = events.find((event) => event.type === "toolCall.updated");
    assert.ok(update);
    const payload = update.data as {
      runId?: string;
      turnId?: string;
      liveMessageId?: string;
      contentIndex?: number;
      toolCall: {
        runId?: string;
        turnId?: string;
        liveMessageId?: string;
        contentIndex?: number;
      };
    };
    // Both the envelope and the embedded transcript record carry the anchor.
    assert.equal(payload.runId, "run_01H00000000000000000000000");
    assert.equal(payload.turnId, "turn_01H0000000000000000000000");
    assert.equal(payload.liveMessageId, "msg_01H00000000000000000000000");
    assert.equal(payload.contentIndex, 2);
    assert.equal(payload.toolCall.runId, "run_01H00000000000000000000000");
    assert.equal(payload.toolCall.turnId, "turn_01H0000000000000000000000");
    assert.equal(
      payload.toolCall.liveMessageId,
      "msg_01H00000000000000000000000",
    );
    assert.equal(payload.toolCall.contentIndex, 2);

    const rawLog = await readFile(
      join(home, "logs", "tool-calls.jsonl"),
      "utf8",
    );
    assert.match(rawLog, /Validation failed for tool edit/);
  });

  it("reconciles interrupted executable states during hydration and emits facts", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-hydrate-"));
    const testAgent = agent("autonomous");
    const records = [
      toolRecord({ id: "tool_requested", status: "requested" }),
      toolRecord({ id: "tool_running", status: "running" }),
      toolRecord({ id: "tool_pending", status: "pending_approval" }),
      toolRecord({ id: "tool_waiting", status: "waiting_for_user" }),
      toolRecord({ id: "tool_completed", status: "completed" }),
    ];
    await mkdir(join(home, "logs"), { recursive: true });
    await writeFile(
      join(home, "logs", "tool-calls.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );

    const first = buildToolService(home, testAgent);
    await first.service.hydrate();
    assert.deepEqual(
      first.events.map((event) => event.type),
      ["toolCall.updated", "toolCall.updated"],
    );
    for (const id of ["tool_requested", "tool_running"]) {
      const repaired = first.service.getToolCall(id);
      assert.equal(repaired.status, "error");
      assert.equal(
        repaired.error,
        "Tool execution was interrupted because the host restarted.",
      );
      assert.equal(
        (repaired.result as { content?: string }).content,
        repaired.error,
      );
    }
    assert.equal(
      first.service.getToolCall("tool_pending").status,
      "pending_approval",
    );
    assert.equal(
      first.service.getToolCall("tool_waiting").status,
      "waiting_for_user",
    );
    assert.equal(
      first.service.getToolCall("tool_completed").status,
      "completed",
    );

    const persisted = (
      await readFile(join(home, "logs", "tool-calls.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ToolCallRecord);
    assert.equal(persisted.length, records.length + 2);
    const second = buildToolService(home, testAgent);
    await second.service.hydrate();
    assert.equal(second.service.getToolCall("tool_running").status, "error");
    assert.deepEqual(second.events, []);
    const afterSecondHydrate = (
      await readFile(join(home, "logs", "tool-calls.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    assert.equal(afterSecondHydrate.length, records.length + 2);
  });

  it("restarts a running tool into an interrupted fact that replays from its conversation stream", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-stream-restart-"));
    try {
      const testAgent = agent("autonomous");
      const running = toolRecord({
        id: "tool_running_restart",
        status: "running",
        runId: "run_01H00000000000000000000000",
      });
      await mkdir(join(home, "logs"), { recursive: true });
      await writeFile(
        join(home, "logs", "tool-calls.jsonl"),
        `${JSON.stringify(running)}\n`,
        "utf8",
      );

      const firstRegistry = new StreamLogRegistry(home);
      await firstRegistry.hydrate();
      const first = buildToolService(home, testAgent, {
        publish: (type, data) => firstRegistry.publish(type, data),
      });
      await first.service.hydrate();
      await firstRegistry.shutdown();

      const restartedRegistry = new StreamLogRegistry(home);
      await restartedRegistry.hydrate();
      const replay = await restartedRegistry.readStream(
        `conv/${running.conversationId}`,
        1,
        100,
      );
      assert.equal(replay.latestSeq, 1);
      assert.equal(replay.events[0]?.type, "toolCall.updated");
      const toolCall = (replay.events[0]?.data as { toolCall?: ToolCallRecord })
        ?.toolCall;
      assert.equal(toolCall?.status, "error");
      assert.equal(toolCall?.errorDetails?.code, "interrupted");
      assert.equal(replay.events[0]?.seq, 1);
      await restartedRegistry.shutdown();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("force-stages policy-allowed tools for approval", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-force-approval-"));
    const testAgent = agent("autonomous");
    const { service, events } = buildToolService(home, testAgent);

    const response = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "stage me", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );

    assert.equal(response.toolCall.status, "pending_approval");
    assert.equal(response.approval?.status, "pending");
    assert.equal(service.listApprovals("pending").length, 1);
    assert.equal(
      (
        events.find((event) => event.type === "policy.evaluated")?.data as {
          decision?: string;
        }
      ).decision,
      "approval",
    );
  });

  it("defers approval execution and terminalization until finalization", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-deferred-approval-"));
    const testAgent = agent("autonomous");
    const { service } = buildToolService(home, testAgent);
    const response = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "execute later", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );
    const approvalId = response.approval!.id;

    const granted = await service.decideApproval(
      approvalId,
      "allow",
      "approved",
    );
    assert.equal(granted.status, "granted");
    assert.equal(granted.resolutionNote, "approved");
    assert.equal(
      service.getToolCall(response.toolCall.id).status,
      "pending_approval",
    );

    const completed = await service.finalizeDecidedApproval(approvalId);
    assert.equal(completed.status, "completed");
    assert.equal(
      (await service.finalizeDecidedApproval(approvalId)).status,
      "completed",
    );

    const deniedResponse = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "deny later", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );
    await service.decideApproval(
      deniedResponse.approval!.id,
      "deny",
      "not now",
    );
    assert.equal(
      service.getToolCall(deniedResponse.toolCall.id).status,
      "pending_approval",
    );
    const denied = await service.finalizeDecidedApproval(
      deniedResponse.approval!.id,
    );
    assert.equal(denied.status, "denied");
    assert.equal(denied.error, "not now");
    assert.equal(
      (await service.finalizeDecidedApproval(deniedResponse.approval!.id))
        .status,
      "denied",
    );
  });

  it("terminalizes every non-terminal tool call when a run ends", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-reconcile-"));
    const testAgent = agent("autonomous");
    const { service, events } = buildToolService(home, testAgent);

    const runId = "run_01H00000000000000000000000";
    const otherRun = "run_01H0000000000000000000000Z";
    service.toolCalls.set(
      "tool_running",
      toolRecord({ id: "tool_running", status: "running", runId }),
    );
    service.toolCalls.set(
      "tool_requested",
      toolRecord({ id: "tool_requested", status: "requested", runId }),
    );
    service.toolCalls.set(
      "tool_pending",
      toolRecord({ id: "tool_pending", status: "pending_approval", runId }),
    );
    service.toolCalls.set(
      "tool_waiting",
      toolRecord({ id: "tool_waiting", status: "waiting_for_user", runId }),
    );
    service.toolCalls.set(
      "tool_completed",
      toolRecord({ id: "tool_completed", status: "completed", runId }),
    );
    service.toolCalls.set(
      "tool_other_run",
      toolRecord({ id: "tool_other_run", status: "running", runId: otherRun }),
    );

    const terminated = await service.terminateNonTerminalToolCallsForRun(
      runId,
      "interrupted",
    );

    assert.deepEqual(terminated.map((toolCall) => toolCall.id).sort(), [
      "tool_pending",
      "tool_requested",
      "tool_running",
      "tool_waiting",
    ]);
    for (const toolCall of terminated) {
      assert.equal(toolCall.status, "error");
      assert.equal(toolCall.error, "interrupted");
      assert.equal(toolCall.errorDetails?.code, "interrupted");
    }
    assert.equal(service.getToolCall("tool_running").status, "error");
    assert.equal(service.getToolCall("tool_requested").status, "error");
    assert.equal(service.getToolCall("tool_pending").status, "error");
    assert.equal(service.getToolCall("tool_waiting").status, "error");
    assert.equal(service.getToolCall("tool_completed").status, "completed");
    assert.equal(service.getToolCall("tool_other_run").status, "running");
    const updates = events.filter((event) => event.type === "toolCall.updated");
    assert.equal(updates.length, 4);
  });
});

function buildToolService(
  home: string,
  testAgent: AgentRecord,
  publisher?: { publish(type: string, data: unknown): Promise<unknown> },
) {
  const events: Array<{ type: string; data: unknown }> = [];
  const service = new ToolService(
    {
      paths: storagePaths(home),
      settings: defaultSettings,
      localToken: "test",
    },
    (publisher ?? {
      publish: async (type: string, data: unknown) =>
        events.push({ type, data }),
    }) as never,
    {
      upsertToolCall: () => undefined,
      upsertApproval: () => undefined,
    } as never,
    {} as never,
    {
      runtimeForProject: async () => undefined,
      isAvailableForProject: async () => false,
      statusSnapshot: () => ({
        available: false,
        source: "unavailable",
        error: "not used",
      }),
      refresh: async () => ({
        available: false,
        source: "unavailable",
        error: "not used",
      }),
    } as never,
    async () => {
      throw new Error("not used");
    },
    () => testAgent,
    async () => {
      throw new Error("not used");
    },
    async () => undefined,
    {} as never,
    async () => testAgent,
    {} as never,
  );
  return { service, events };
}

function toolRecord(
  overrides: Partial<ToolCallRecord> & Pick<ToolCallRecord, "id" | "status">,
): ToolCallRecord {
  return {
    agentId: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    toolName: "bash",
    risk: "command",
    args: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function agent(permissionLevel: AgentRecord["permissionLevel"]): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    workerId: "worker_01HN0000000000000000000000",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode: "coding",
    permissionLevel,
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
