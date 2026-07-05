// biome-ignore lint/style/noExcessiveLinesPerFile: Sandbox schema coverage intentionally keeps related fixtures and protocol cases together.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  managedContainerCreateSpecSchema,
  managedSandboxRecordSchema,
  managerOutboundCommandRecordSchema,
  protocolMethodDefinition,
  protocolMethodParamsSchema,
  sandboxAckStateSchema,
  sandboxAgentConfigureParamsSchema,
  sandboxCanonicalJson,
  sandboxCommandRecordSchema,
  sandboxConfigV1Schema,
  sandboxConversationViewSnapshotSchema,
  sandboxCreateConfigInputSchema,
  sandboxCreateRequestSchema,
  sandboxEventPayloadSchemas,
  sandboxManagerEventEnvelopeSchema,
  sandboxManagerLifecycleEventTypeSchema,
  sandboxProtocolCursorSchema,
  sandboxProtocolEventBatchSchema,
  sandboxProtocolEventSchema,
  sandboxProtocolFlowUpdateSchema,
  sandboxProtocolHelloSchema,
  sandboxProtocolUiHelloSchema,
  sandboxRunExecutionRecordSchema,
  sandboxRunStartParamsSchema,
  sandboxSecretRefSchema,
  sandboxSnapshotResultSchema,
  sandboxStatusGetParamsSchema,
  sandboxStatusGetResultSchema,
  sandboxTaskRecordSchema,
  sandboxToolCallRecordSchema,
  sandboxTranscriptEntrySchema,
  sandboxWaitResolutionRecordSchema,
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
      mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
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
  });

  it("validates secret references and requires a default kv store when omitted", () => {
    assert.equal(
      sandboxSecretRefSchema.safeParse({ env: "TOKEN" }).success,
      true,
    );
    assert.equal(
      sandboxSecretRefSchema.safeParse({ file: "/secrets/token" }).success,
      true,
    );
    assert.equal(
      sandboxSecretRefSchema.safeParse({ kv: { store: "main", key: "token" } })
        .success,
      true,
    );

    const withoutDefaultStore = {
      ...minimalConfig(),
      controller: {
        websocket: { url: "wss://manager.example.test/ws" },
        auth: { type: "api_key", apiKey: { kv: { key: "controller" } } },
      },
      secretStores: {
        stores: { main: { type: "http_kv", endpoint: "https://secrets.test" } },
      },
    };
    assert.equal(
      sandboxConfigV1Schema.safeParse(withoutDefaultStore).success,
      false,
    );
    assert.equal(
      sandboxConfigV1Schema.safeParse({
        ...withoutDefaultStore,
        secretStores: {
          defaultStore: "main",
          stores: {
            main: { type: "http_kv", endpoint: "https://secrets.test" },
          },
        },
      }).success,
      true,
    );
  });

  it("rejects invalid sandbox v1 config combinations", () => {
    assert.equal(
      sandboxConfigV1Schema.safeParse({
        ...minimalConfig(),
        boot: {
          script: "pnpm install",
          phases: [{ name: "install", script: "pnpm install" }],
        },
      }).success,
      false,
    );
    assert.equal(
      sandboxConfigV1Schema.safeParse({
        ...minimalConfig(),
        controller: {
          ...minimalConfig().controller,
          disconnectPolicy: { mode: "stay_reconnecting", exitAfterMs: 1000 },
        },
      }).success,
      false,
    );
    assert.equal(
      sandboxConfigV1Schema.safeParse({
        ...minimalConfig(),
        tools: {
          groups: { jira: { enabled: true, siteUrl: "https://jira.test" } },
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
        agent: { mainModel: { provider: "corp", model: "chat" } },
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
        agent: { mainModel: { provider: "corp", model: "chat" } },
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

  it("validates sandbox controller protocol messages", () => {
    assert.equal(
      sandboxProtocolHelloSchema.safeParse({
        type: "hello",
        version: 1,
        role: "agent",
        sandboxId: "sbx_1",
        instanceId: "inst_1",
        capabilities: ["status"],
      }).success,
      true,
    );
    assert.equal(
      sandboxProtocolHelloSchema.safeParse({
        type: "hello",
        version: 1,
        role: "controller",
        sandboxId: "sbx_1",
        instanceId: "inst_1",
        capabilities: ["status"],
      }).success,
      false,
    );
    assert.equal(
      sandboxProtocolEventBatchSchema.safeParse({
        type: "event.batch",
        batchId: "batch_1",
        stream: "sandbox",
        firstSeq: 2,
        lastSeq: 2,
        events: [{ seq: 1, ts, type: "sandbox.ready" }],
      }).success,
      false,
    );
    assert.equal(
      sandboxProtocolFlowUpdateSchema.safeParse({
        type: "flow.update",
        stream: "sandbox",
        queue: { pendingEvents: 5, maxEvents: 100 },
        reason: "backpressure",
      }).success,
      true,
    );
  });

  it("validates the manager UI hello and rejects non-ui roles", () => {
    assert.equal(
      sandboxProtocolUiHelloSchema.safeParse({
        type: "hello",
        role: "ui",
        capabilities: ["encoding.json", "event.batch"],
        resume: { cursors: [{ stream: "manager", processedSeq: 3 }] },
      }).success,
      true,
    );
    assert.equal(
      sandboxProtocolUiHelloSchema.safeParse({
        type: "hello",
        role: "agent",
        capabilities: ["encoding.json"],
      }).success,
      false,
    );
  });

  it("accepts create input with an omitted controller and full config alike", () => {
    const { controller: _controller, ...withoutController } = minimalConfig();
    assert.equal(
      sandboxCreateConfigInputSchema.safeParse(withoutController).success,
      true,
    );
    assert.equal(
      sandboxCreateConfigInputSchema.safeParse(minimalConfig()).success,
      true,
    );
    assert.equal(
      sandboxCreateRequestSchema.safeParse({
        config: withoutController,
        image: "nerve-sandbox:dev",
        name: "demo",
        start: true,
      }).success,
      true,
    );
  });

  it("validates manager lifecycle event types and UI event envelopes", () => {
    assert.equal(
      sandboxManagerLifecycleEventTypeSchema.safeParse(
        "manager.sandbox.started",
      ).success,
      true,
    );
    assert.equal(
      sandboxManagerLifecycleEventTypeSchema.safeParse("manager.sandbox.nope")
        .success,
      false,
    );
    assert.equal(
      sandboxManagerEventEnvelopeSchema.safeParse({
        stream: "manager",
        seq: 4,
        ts,
        type: "manager.sandbox.started",
        durability: "durable",
        data: { sandboxId: "sbx_1" },
      }).success,
      true,
    );
    // Envelopes never force sandbox daemon payload validation.
    assert.equal(
      sandboxManagerEventEnvelopeSchema.safeParse({
        stream: "sandbox:sbx_1",
        sandboxId: "sbx_1",
        seq: 1,
        ts,
        type: "sandbox.ready",
        data: { arbitrary: true },
      }).success,
      true,
    );
  });

  it("validates sandbox chat protocol method definitions", () => {
    assert.equal(
      sandboxAgentConfigureParamsSchema.safeParse({
        sandboxId: "sbx_1",
        conversationId: "conv_1",
        agentId: "agent_1",
        model: {
          provider: "openai",
          model: "gpt-5.4-mini",
          thinkingLevel: "medium",
        },
        mode: "coding",
        permissionLevel: "supervised",
        approvalPolicy: { autoApproveReadOnly: false },
        modelProfileId: "profile_openai_default",
      }).success,
      true,
    );
    assert.equal(
      protocolMethodParamsSchema("sandbox.agent.configure").safeParse({
        sandboxId: "sbx_1",
        model: { provider: "openai", model: "gpt-5.4-mini" },
        permissionLevel: "autonomous",
      }).success,
      true,
    );
    assert.equal(
      protocolMethodParamsSchema("sandbox.agent.configure").safeParse({
        model: { provider: "openai", model: "gpt-5.4-mini" },
      }).success,
      false,
    );
    assert.equal(
      protocolMethodDefinition("sandbox.agent.prompt").idempotency,
      "required",
    );
    assert.equal(
      protocolMethodDefinition("sandbox.conversation.snapshot.get").kind,
      "read",
    );
  });

  it("validates rich sandbox conversation view snapshots", () => {
    assert.equal(
      sandboxConversationViewSnapshotSchema.safeParse({
        sandboxId: "sbx_1",
        instanceId: "inst_1",
        status: "ready",
        connected: true,
        conversationId: "conv_1",
        agentId: "agent_1",
        runId: "run_1",
        fallback: {
          conversations: [{ conversationId: "conv_1", agentIds: ["agent_1"] }],
          agents: [
            {
              conversationId: "conv_1",
              agentId: "agent_1",
              permissionLevel: "supervised",
            },
          ],
          runs: [
            {
              conversationId: "conv_1",
              agentId: "agent_1",
              runId: "run_1",
              status: "running",
            },
          ],
          readOnly: true,
          reason: "controller disconnected",
        },
        generatedAt: ts,
      }).success,
      true,
    );
  });

  it("validates representative command parameter shapes", () => {
    assert.equal(
      sandboxRunStartParamsSchema.safeParse({
        commandId: "cmd_1",
        conversationId: "conv_1",
        agentId: "agent_1",
        prompt: "Build the project",
      }).success,
      true,
    );
    assert.equal(
      sandboxStatusGetParamsSchema.safeParse({ includeConfig: "sanitized" })
        .success,
      true,
    );
    assert.equal(
      sandboxStatusGetParamsSchema.safeParse({ includeConfig: "raw" }).success,
      false,
    );
  });

  it("validates manager records and create specs", () => {
    assert.equal(
      managedSandboxRecordSchema.safeParse({
        sandboxId: "sbx_1",
        backend: "docker",
        image: { reference: "nerve-sandbox:dev", sandboxSpec: "v1" },
        desiredState: "running",
        observedState: "starting",
        workspaceRef: {
          kind: "bind",
          source: "/tmp/workspace",
          target: "/workspace",
        },
        stateRef: { kind: "bind", source: "/tmp/state", target: "/state" },
        createdAt: ts,
        updatedAt: ts,
      }).success,
      true,
    );
    assert.equal(
      managedContainerCreateSpecSchema.safeParse({
        sandboxId: "sbx_1",
        instanceId: "inst_1",
        image: "nerve-sandbox:dev",
        env: {},
        labels: { "org.nerve.sandbox.spec": "v1" },
        mounts: [
          { kind: "bind", source: "/tmp/workspace", target: "/workspace" },
          { kind: "bind", source: "/tmp/state", target: "/state" },
        ],
      }).success,
      true,
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
      sandboxCommandRecordSchema.safeParse({
        commandId: "cmd_1",
        messageId: "msg_1",
        method: "sandbox.run.start",
        paramsHash: `sha256:${"a".repeat(64)}`,
        params: {},
        acceptedAt: ts,
        status: "accepted",
      }).success,
      true,
    );
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
        commandId: "cmd_2",
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
      managerOutboundCommandRecordSchema.safeParse({
        requestId: "req_1",
        sandboxId: "sbx_1",
        method: "sandbox.status.get",
        paramsHash: `sha256:${"b".repeat(64)}`,
        status: "sent",
        createdAt: ts,
        sentAt: ts,
      }).success,
      true,
    );
    assert.equal(
      sandboxProtocolCursorSchema.safeParse({
        stream: "sandbox",
        processedSeq: 1,
      }).success,
      true,
    );
    assert.equal(
      sandboxAckStateSchema.safeParse({ stream: "sandbox", processedSeq: 1 })
        .success,
      false,
    );
  });

  it("validates known protocol event payloads and allows unknown event types", () => {
    assert.equal(
      sandboxProtocolEventSchema.safeParse({
        seq: 1,
        ts,
        type: "sandbox.ready",
        data: { invalid: true },
      }).success,
      false,
    );
    assert.equal(
      sandboxProtocolEventSchema.safeParse({
        seq: 1,
        ts,
        type: "future.event",
        data: { anything: true },
      }).success,
      true,
    );
  });

  it("validates representative live streaming event payloads", () => {
    const scope = {
      instanceId: "inst_1",
      conversationId: "conv_1",
      agentId: "agent_1",
      runId: "run_1",
    };
    assert.equal(
      sandboxEventPayloadSchemas["run.delta"].safeParse({
        ...scope,
        deltaId: "delta_1",
        role: "assistant",
        text: "hello",
      }).success,
      true,
    );
    assert.equal(
      sandboxEventPayloadSchemas["run.transcript.appended"].safeParse({
        ...scope,
        entryId: "entry_1",
        index: 0,
        role: "assistant",
        content: { text: "hello" },
        createdAt: ts,
      }).success,
      true,
    );
    for (const [type, status] of [
      ["tool.call.requested", "requested"],
      ["tool.call.started", "started"],
      ["tool.call.completed", "completed"],
      ["tool.call.failed", "failed"],
      ["tool.call.cancelled", "cancelled"],
    ] as const) {
      assert.equal(
        sandboxEventPayloadSchemas[type].safeParse({
          ...scope,
          toolCallId: "tool_1",
          toolName: "read",
          status,
          displayArgs: { path: "README.md" },
          lifecycleSeq: 1,
          error:
            status === "failed"
              ? { code: "TOOL_FAILED", message: "redacted" }
              : undefined,
          cancelledAt: status === "cancelled" ? ts : undefined,
        }).success,
        true,
        type,
      );
    }
    assert.equal(
      sandboxEventPayloadSchemas["run.waiting_for_input"].safeParse({
        ...scope,
        requestId: "tool_ask",
        question: { text: "Proceed?" },
        required: true,
        createdAt: ts,
      }).success,
      true,
    );
    assert.equal(
      sandboxEventPayloadSchemas["run.waiting_for_approval"].safeParse({
        ...scope,
        approvalId: "approval_1",
        toolCallId: "tool_1",
        risk: ["shell"],
        reason: "approval required",
        normalizedArgs: { command: "pnpm check" },
        createdAt: ts,
      }).success,
      true,
    );
    assert.equal(
      sandboxEventPayloadSchemas["run.failed"].safeParse({
        ...scope,
        status: "failed",
        failedAt: ts,
        error: {
          code: "PROVIDER_FAILED",
          message: "temporarily unavailable",
          retryable: true,
        },
      }).success,
      true,
    );
  });

  it("validates conversation events carried by sandbox protocol", () => {
    const liveScope = {
      conversationId: "conv_1",
      agentId: "agent_1",
      projectId: "proj_1",
      runId: "run_1",
      turnId: "turn_1",
      liveMessageId: "msg_1",
      contentBlockId: "block_1",
      contentIndex: 0,
    };
    assert.equal(
      sandboxProtocolEventSchema.safeParse({
        seq: 2,
        ts,
        type: "conversation.live.content.delta",
        durability: "transient",
        data: {
          ...liveScope,
          kind: "thinking",
          offset: 0,
          delta: "Considering the next step",
        },
      }).success,
      true,
    );
    assert.equal(
      sandboxProtocolEventSchema.safeParse({
        seq: 3,
        ts,
        type: "conversation.live.tool_draft.started",
        durability: "transient",
        data: {
          ...liveScope,
          providerToolCallId: "call_1",
          toolName: "read",
        },
      }).success,
      true,
    );
    assert.equal(
      sandboxProtocolEventSchema.safeParse({
        seq: 4,
        ts,
        type: "conversation.live.tool_draft.delta",
        data: {
          ...liveScope,
          providerToolCallId: "call_1",
          toolName: "read",
          offset: 0,
          delta: '{"path":"README.md"',
        },
      }).success,
      true,
    );
    assert.equal(
      sandboxProtocolEventSchema.safeParse({
        seq: 5,
        ts,
        type: "conversation.live.tool_draft.done",
        data: {
          ...liveScope,
          providerToolCallId: "call_1",
          toolName: "read",
          args: { path: "README.md" },
        },
      }).success,
      true,
    );
    assert.equal(
      sandboxProtocolEventSchema.safeParse({
        seq: 6,
        ts,
        type: "conversation.live.content.delta",
        data: { ...liveScope, kind: "private_thought", offset: 0, delta: "x" },
      }).success,
      false,
    );
  });

  it("validates sandbox event payload status values", () => {
    const ready = {
      instanceId: "inst_1",
      status: "ready",
      readyAt: ts,
      recovered: false,
      daemonStatus: "ready",
      cursor: { streams: [{ stream: "sandbox", processedSeq: 0 }] },
    };
    assert.equal(
      sandboxEventPayloadSchemas["sandbox.ready"].safeParse(ready).success,
      true,
    );
    assert.equal(
      sandboxEventPayloadSchemas["sandbox.ready"].safeParse({
        ...ready,
        daemonStatus: "sleeping",
      }).success,
      false,
    );
  });
});
