import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts";
import { defaultSettings } from "@nervekit/contracts";
import { ToolService } from "../src/domains/tools/tool-service.js";
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

    const canonical = await readFile(
      join(
        home,
        "conversations",
        toolCall.conversationId,
        "tool-calls",
        `${toolCall.id}.json`,
      ),
      "utf8",
    );
    assert.match(canonical, /Validation failed for tool edit/);
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
});

function buildToolService(
  home: string,
  testAgent: AgentRecord,
  publisher?: { publish(type: string, data: unknown): Promise<unknown> },
  pythonRuntime?: {
    runtimeForProject(projectDir: string): Promise<undefined>;
  },
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
