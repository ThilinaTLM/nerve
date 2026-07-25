import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  managedContainerRefSchema,
  operationDefinition,
  operationParamsSchema,
  parsePublicEventEnvelope,
  sandboxCanonicalJson,
  sandboxConfigV1Schema,
  sandboxEventEnvelopeSchema,
  sandboxRunExecutionRecordSchema,
  sandboxSnapshotResultSchema,
  sandboxStatusGetResultSchema,
  sandboxTaskRecordSchema,
  sandboxToolCallRecordSchema,
  sandboxTranscriptEntrySchema,
  sandboxWaitResolutionRecordSchema,
  streamCursorSchema,
} from "../src/index.js";

const ts = "2026-06-26T12:00:00.000Z";
function containsSensitiveValue(value: unknown): boolean {
  if (typeof value === "string")
    return /(sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|bearer\s+[a-z0-9_.-]+|password=|api[_-]?key=|token=)/i.test(
      value,
    );
  if (Array.isArray(value)) return value.some(containsSensitiveValue);
  if (value && typeof value === "object")
    return Object.values(value).some(containsSensitiveValue);
  return false;
}

function minimalConfig() {
  return {
    version: 1,
    agent: {
      defaultModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
    },
    controller: {
      websocket: { url: "wss://manager.example.test/api/sandboxes/sbx/ws" },
      auth: { type: "api_key", apiKey: { env: "NERVE_CONTROLLER_API_KEY" } },
    },
  };
}

describe("Sandbox shared schemas", () => {
  it("validates a minimal v1 config and rejects unknown top-level fields", () => {
    assert.equal(
      sandboxConfigV1Schema.safeParse(minimalConfig()).success,
      true,
    );
    assert.equal(
      sandboxConfigV1Schema.safeParse({ ...minimalConfig(), unexpected: true })
        .success,
      false,
    );
    assert.equal(
      sandboxConfigV1Schema.safeParse({
        ...minimalConfig(),
        agent: {
          mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
        },
      }).success,
      false,
    );
    assert.equal(
      sandboxConfigV1Schema.safeParse({
        ...minimalConfig(),
        agent: {
          ...minimalConfig().agent,
          exploreModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
          initialPrompt: "hello",
        },
      }).success,
      false,
    );
  });

  it("hardens v1 config validation for providers, secret cycles, and raw credentials", () => {
    assert.equal(
      sandboxConfigV1Schema.safeParse({
        ...minimalConfig(),
        modelCatalog: {
          providers: [{ id: "corp", baseUrl: "https://llm.example.test" }],
          models: [{ provider: "corp", model: "chat" }],
        },
        agent: { defaultModel: { provider: "corp", model: "chat" } },
      }).success,
      false,
    );
    assert.equal(
      sandboxConfigV1Schema.safeParse({
        ...minimalConfig(),
        secretStores: {
          stores: {
            main: {
              type: "http_kv",
              endpoint: "https://secrets.example.test",
              auth: {
                type: "bearer",
                token: { kv: { store: "main", key: "token" } },
              },
            },
          },
        },
      }).success,
      false,
    );
    assert.equal(
      sandboxConfigV1Schema.safeParse({
        ...minimalConfig(),
        modelCatalog: {
          providers: [
            {
              id: "corp",
              api: "openai-compatible",
              baseUrl: "https://llm.example.test",
              credential: { type: "bearer", token: { env: "CORP_TOKEN" } },
            },
          ],
          models: [{ provider: "corp", model: "chat" }],
        },
        agent: { defaultModel: { provider: "corp", model: "chat" } },
      }).success,
      true,
    );
    assert.equal(
      sandboxConfigV1Schema.safeParse({
        ...minimalConfig(),
        modelCatalog: {
          providers: [
            {
              id: "corp",
              builtin: true,
              headers: { authorization: "sk-abcdefghijklmnopqrstuvwxyz" },
            },
          ],
        },
      }).success,
      false,
    );
  });

  it("keeps canonical JSON stable across object key order", () => {
    assert.equal(
      sandboxCanonicalJson({ b: 2, a: { d: 4, c: 3 } }),
      sandboxCanonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("validates canonical sandbox-targeted operation definitions", () => {
    assert.equal(
      operationParamsSchema("agent.configure").safeParse({
        agentId: "agent_1",
        model: { provider: "openai", modelId: "gpt-5.4-mini" },
        thinkingLevel: "medium",
        mode: "coding",
        permissionLevel: "supervised",
        approvalPolicy: { autoApproveReadOnly: false },
      }).success,
      true,
    );
    assert.equal(
      operationParamsSchema("run.start").safeParse({
        conversationId: "conv_1",
        agentId: "agent_1",
        text: "Implement the plan",
      }).success,
      true,
    );
    assert.equal(operationDefinition("run.start").idempotency, "required");
    assert.deepEqual(operationDefinition("run.start").allowedTargetRoles, [
      "workbench_server",
      "sandbox_agent",
    ]);
    assert.equal(
      operationDefinition("sandbox.conversation.snapshot.get").kind,
      "read",
    );
    assert.deepEqual(
      operationDefinition("sandbox.status.get").allowedTargetRoles,
      ["sandbox_manager", "sandbox_agent"],
    );
  });

  it("validates host and manager operation definitions", () => {
    const readMethods = [
      "git.repos.discover",
      "git.overview.get",
      "git.branches.list",
      "github.status.get",
      "github.pr.list",
      "github.pr.get",
      "task.list",
      "task.get",
      "task.logs",
      "sandbox.list",
      "sandbox.get",
    ] as const;
    for (const method of readMethods) {
      assert.equal(operationDefinition(method).kind, "read");
      assert.equal(operationDefinition(method).idempotency, "none");
    }

    const mutationMethods = [
      "git.branch.create",
      "git.branch.switch",
      "git.file.stage",
      "git.file.unstage",
      "git.file.discard",
      "git.sync",
      "git.push",
      "git.pull",
      "git.fetch",
      "git.switchBaseAndPull",
      "github.pr.checkout",
      "task.start",
      "task.cancel",
      "task.restart",
      "task.prune",
      "task.delete",
      "sandbox.start",
      "sandbox.stop",
      "sandbox.restart",
    ] as const;
    for (const method of mutationMethods) {
      assert.notEqual(operationDefinition(method).idempotency, "none");
    }

    assert.equal(
      operationParamsSchema("task.start").safeParse({
        cwd: "/workspace",
        command: "pnpm test",
      }).success,
      true,
    );
    assert.equal(
      operationParamsSchema("sandbox.create").safeParse({}).success,
      false,
    );
    assert.equal(
      operationParamsSchema("github.pr.get").safeParse({
        projectId: "proj_1",
        repo: ".",
        number: 123,
      }).success,
      true,
    );
  });
  it("validates non-secret managed container metadata", () => {
    assert.equal(
      managedContainerRefSchema.safeParse({
        kind: "ecs",
        id: "arn:aws:ecs:us-east-1:123456789012:task/cluster/task-id",
        name: "nerve-sbx_1",
        metadata: {
          sandboxId: "sbx_1",
          taskDefinitionArn:
            "arn:aws:ecs:us-east-1:123456789012:task-definition/nerve-sandbox:1",
          clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/nerve",
          logGroup: "/aws/ecs/nerve-sandbox",
          logStream: "sandbox/sandbox-agent/task-id",
        },
      }).success,
      true,
    );
    assert.equal(
      managedContainerRefSchema.safeParse({
        kind: "ecs",
        id: "task",
        metadata: { controllerToken: "ntok_secret" },
      }).success,
      false,
    );
  });

  it("validates hardened state and snapshot fixtures", () => {
    const fixturesDir = path.join(process.cwd(), "test/fixtures/sandbox");
    const fixtures = readdirSync(fixturesDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => ({
        file,
        value: JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")),
      }));
    for (const fixture of fixtures) {
      const schema = fixture.file.startsWith("status-")
        ? sandboxStatusGetResultSchema
        : sandboxSnapshotResultSchema;
      const result = schema.safeParse(fixture.value);
      assert.equal(result.success, true, fixture.file);
      assert.equal(containsSensitiveValue(fixture.value), false, fixture.file);
    }
    const status = fixtures.find(
      (fixture) => fixture.file === "status-valid.json",
    )?.value;
    const snapshot = fixtures.find(
      (fixture) => fixture.file === "snapshot-valid.json",
    )?.value;
    assert.ok(status);
    assert.ok(snapshot);
    assert.equal(
      sandboxTranscriptEntrySchema.safeParse({
        entryId: "entry_1",
        index: 0,
        conversationId: "conv_1",
        agentId: "agent_1",
        runId: "run_1",
        role: "assistant",
        content: { text: "hello" },
        createdAt: ts,
      }).success,
      true,
    );
    assert.equal(
      sandboxToolCallRecordSchema.safeParse({
        toolCallId: "tool_1",
        conversationId: "conv_1",
        agentId: "agent_1",
        runId: "run_1",
        toolName: "read",
        status: "completed",
        displayArgs: { path: "README.md" },
        artifactRefs: [{ path: "artifacts/tool_1/result.txt" }],
        turnId: "turn_1",
        liveMessageId: "msg_1",
        contentIndex: 2,
        lifecycleSeq: 3,
        redactionVersion: 1,
        requestedAt: ts,
      }).success,
      true,
    );
    assert.equal(
      sandboxWaitResolutionRecordSchema.safeParse({
        waitId: "wait_1",
        kind: "input",
        conversationId: "conv_1",
        agentId: "agent_1",
        runId: "run_1",
        requestId: "req_2",
        status: "submitted",
        resolvedAt: ts,
      }).success,
      true,
    );
    assert.equal(
      sandboxRunExecutionRecordSchema.safeParse({
        conversationId: "conv_1",
        agentId: "agent_1",
        runId: "run_1",
        executionId: "exec_1",
        recoverability: "checkpoint",
        status: "streaming",
        startedAt: ts,
      }).success,
      true,
    );
    assert.equal(
      sandboxTaskRecordSchema.safeParse({
        taskId: "task_1",
        command: "pnpm check",
        status: "running",
        createdAt: ts,
        updatedAt: ts,
      }).success,
      true,
    );
    assert.equal(
      streamCursorSchema.safeParse({
        stream: "sandbox",
        processedSeq: 1,
      }).success,
      true,
    );
  });

  it("validates known protocol event payloads and rejects unknown event types", () => {
    assert.equal(
      sandboxEventEnvelopeSchema.safeParse({
        id: "evt_ready",
        seq: 1,
        ts,
        type: "sandbox.ready",
        data: { invalid: true },
      }).success,
      false,
    );
    assert.equal(
      sandboxEventEnvelopeSchema.safeParse({
        id: "evt_future",
        seq: 1,
        ts,
        type: "future.event",
        data: { anything: true },
      }).success,
      false,
    );
  });

  it("accepts current and previously persisted run cancellation events", () => {
    const envelope = {
      id: "evt_cancelled",
      seq: 1,
      ts,
      type: "run.cancelled",
    };
    assert.equal(
      parsePublicEventEnvelope(
        {
          ...envelope,
          data: {
            conversationId: "conv_1",
            agentId: "agent_1",
            projectId: "proj_1",
            runId: "run_1",
            cancelledAt: ts,
          },
        },
        "workbench_server",
      ).type,
      "run.cancelled",
    );
    assert.equal(
      parsePublicEventEnvelope(
        {
          ...envelope,
          data: {
            conversationId: "conv_1",
            agentId: "agent_1",
            runId: "run_1",
            status: "cancelled",
            cancelledAt: ts,
          },
        },
        "sandbox_agent",
      ).type,
      "run.cancelled",
    );
  });
});
