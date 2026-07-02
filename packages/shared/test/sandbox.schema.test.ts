import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  managedContainerCreateSpecSchema,
  managedSandboxRecordSchema,
  sandboxCanonicalJson,
  sandboxConfigV1Schema,
  sandboxEventPayloadSchemas,
  sandboxProtocolEventBatchSchema,
  sandboxProtocolHelloSchema,
  sandboxRunStartParamsSchema,
  sandboxSecretRefSchema,
  sandboxStatusGetParamsSchema,
} from "../src/index.js";

const ts = "2026-06-26T12:00:00.000Z";

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
