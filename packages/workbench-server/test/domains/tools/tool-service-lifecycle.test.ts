import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type {
  ToolCallRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts/tools";
import { defaultSettings } from "@nervekit/contracts/settings";
import { ToolService } from "../../../src/domains/tools/execution/tool-service.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";

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
        edits: [{ oldText: "a", newText: "b", note: "bad" }],
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

    assert.equal(toolCall.status, "failed");
    assert.equal(toolCall.sourceToolCallId, "provider_call_1");
    assert.equal(toolCall.providerToolCallId, "provider_call_1");
    assert.equal(toolCall.error, "Validation failed for tool edit.");
    assert.deepEqual(toolCall.errorDetails, {
      code: "INVALID_TOOL_ARGUMENTS",
      message: "Validation failed for tool edit.",
    });
    assert.deepEqual(toolCall.args, {
      path: "src/file.ts",
      edits: [{ oldText: "a", newText: "b", note: "bad" }],
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

    const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
    const stored = database
      .prepare(`SELECT data FROM conversation_records WHERE id = ?`)
      .get(toolCall.id) as { data: Uint8Array };
    database.close();
    assert.match(
      Buffer.from(stored.data).toString("utf8"),
      /Validation failed for tool edit/,
    );
  });

  it("routes python_exec through the workbench runtime override", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-python-"));
    const testAgent = agent("autonomous");
    const runtimeProjects: string[] = [];
    const { service } = buildToolService(home, testAgent, undefined, {
      runtimeForProject: async (projectDir: string) => {
        runtimeProjects.push(projectDir);
        return undefined;
      },
    });

    const response = await service.requestTool(testAgent, "python_exec", {
      code: "print('ok')",
    });

    assert.deepEqual(runtimeProjects, [testAgent.projectDir]);
    assert.equal(response.toolCall.status, "failed");
    assert.equal(response.toolCall.error, "Python runtime is not available.");
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

    assert.equal(response.toolCall.status, "waiting");
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

  it("retains agent previews for policy and user denials", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-denials-"));
    const readOnlyAgent = agent("read_only");
    const { service } = buildToolService(home, readOnlyAgent);

    const policy = await service.requestTool(readOnlyAgent, "bash", {
      command: "printf x > file.txt",
    });
    assert.equal(policy.toolCall.status, "denied");
    assert.equal(policy.toolCall.phase, "denied");
    assert.match(
      previewText(policy.toolCall),
      /^Permission policy denied the requested tool call\./,
    );
    assert.equal(policy.toolCall.agentProjection?.profile, "terminal_outcome");
    assert.equal(policy.toolCall.resultPayload, undefined);

    const supervisedAgent = agent("autonomous");
    const { service: approvalService } = buildToolService(
      await mkdtemp(join(tmpdir(), "nerve-tool-user-denial-")),
      supervisedAgent,
    );
    const pending = await approvalService.requestTool(
      supervisedAgent,
      "todos_set",
      { todos: [{ todo: "do not apply", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );
    const denied = await approvalService.denyApproval(
      pending.approval!.id,
      "Not now.",
    );
    assert.equal(denied.status, "denied");
    assert.equal(denied.supervision?.source, "user");
    assert.match(previewText(denied), /^User denied the requested tool call\./);
    assert.equal(denied.resultPayload, undefined);
  });

  it("retains an agent preview when resolving an approval denial", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-resolution-denial-"));
    const testAgent = agent("autonomous");
    const { service } = buildToolService(home, testAgent);
    const pending = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "do not apply", done: false }] },
      { forceApproval: true, durableSuspend: true },
    );

    const denied = await service.resolveInteraction({
      toolCallId: pending.toolCall.id,
      interactionOrdinal: 0,
      expectedRevision: pending.toolCall.revision,
      resolutionRequestId: "deny-resolution-1",
      resolution: { kind: "approval", action: "deny", note: "No." },
    });

    assert.equal(denied.status, "denied");
    assert.equal(denied.interactions[0]?.status, "resolved");
    assert.equal(denied.supervision?.status, "denied");
    assert.equal(denied.supervision?.source, "user");
    assert.match(previewText(denied), /^User denied the requested tool call\./);
    assert.equal(denied.resultPayload, undefined);
  });

  it("cancels pending interactions when terminalizing a run", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-terminalize-"));
    const testAgent = agent("autonomous");
    const { service } = buildToolService(home, testAgent);
    const runId = "run_01H00000000000000000000000";

    const response = await service.requestTool(
      testAgent,
      "todos_set",
      { todos: [{ todo: "stage me", done: false }] },
      { forceApproval: true, durableSuspend: true, runId },
    );
    assert.equal(response.toolCall.status, "waiting");
    assert.equal(response.toolCall.interactions[0]?.status, "pending");

    const [terminal] = await service.terminateNonTerminalToolCallsForRun(
      runId,
      {
        status: "cancelled",
        code: "cancelled",
        message: "Run was cancelled.",
      },
    );

    assert.equal(terminal?.status, "cancelled");
    assert.equal(terminal?.phase, "cancelled");
    assert.equal(terminal?.error, "Run was cancelled.");
    assert.equal(terminal?.errorDetails?.code, "cancelled");
    assert.deepEqual(terminal?.result, {
      content: "Run was cancelled.",
      contentBlocks: [{ type: "text", text: "Run was cancelled." }],
    });
    assert.equal(terminal?.interactions[0]?.status, "cancelled");
    assert.ok(terminal?.interactions[0]?.cancelledAt);
    assert.ok(terminal?.settledAt);
    assert.match(previewText(terminal), /^Tool execution was cancelled\./);
    assert.equal(terminal?.agentProjection?.profile, "terminal_outcome");
    assert.equal(terminal?.resultPayload, undefined);
  });
});

function previewText(toolCall: ToolCallRecord | undefined): string {
  return (
    toolCall?.agentPreview?.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n") ?? ""
  );
}

function buildToolService(
  home: string,
  testAgent: AgentRecord,
  publisher?: { publish(type: string, data: unknown): Promise<unknown> },
  pythonRuntime?: {
    runtimeForProject(projectDir: string): Promise<undefined>;
  },
) {
  const events: Array<{ type: string; data: unknown }> = [];
  const previews = new Map<string, ToolCallTranscriptRecord>();
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
      upsertToolCall: (
        record: ToolCallRecord,
        preview: ToolCallTranscriptRecord,
      ) => previews.set(record.id, preview),
      listToolCallPreviews: () => [...previews.values()],
      upsertApproval: () => undefined,
      writeToolCallSnapshot: () => undefined,
      isToolCallSnapshotValid: () => ({ valid: false, reason: "no-meta" }),
      loadToolCalls: () => [],
    } as never,
    {} as never,
    (pythonRuntime ?? {
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
    }) as never,
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

function agent(permissionLevel: AgentRecord["permissionLevel"]): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode: "coding",
    permissionLevel,
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
