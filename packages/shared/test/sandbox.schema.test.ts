import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  managedContainerCreateSpecSchema,
  managedSandboxRecordSchema,
  sandboxAckStateSchema,
  sandboxCanonicalJson,
  sandboxCommandRecordSchema,
  sandboxConfigV1Schema,
  sandboxEventPayloadSchemas,
  sandboxProtocolCursorSchema,
  sandboxProtocolEventBatchSchema,
  sandboxProtocolEventSchema,
  sandboxProtocolHelloSchema,
  sandboxRunStartParamsSchema,
  sandboxSecretRefSchema,
  sandboxSnapshotResultSchema,
  sandboxStatusGetParamsSchema,
  sandboxStatusGetResultSchema,
  sandboxToolCallRecordSchema,
  sandboxTranscriptEntrySchema,
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
        requestedAt: ts,
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
