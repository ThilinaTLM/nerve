import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelInfo } from "@nervekit/shared";
import {
  conversationItemsFor,
  conversationsFor,
  sandboxAvailableModels,
  sandboxConversationActivity,
  sandboxConversationById,
} from "./sandbox-manager-selectors.svelte";
import { createSandboxDetailState } from "./sandbox-ui-types";

function testModel(
  provider: string,
  modelId: string,
  name: string,
  contextWindow: number,
): ModelInfo {
  return {
    provider,
    modelId,
    name,
    label: name,
    reasoning: false,
    supportedThinkingLevels: ["off"],
    contextWindow,
    maxOutputTokens: 0,
  };
}

const managerModels: ModelInfo[] = [
  testModel("openai-codex", "gpt-5.4", "GPT-5.4", 272_000),
  testModel("amazon-bedrock", "nova-lite", "Nova Lite", 128_000),
  testModel("anthropic", "claude-opus-4.5", "Claude Opus 4.5", 200_000),
];

describe("sandbox manager selectors", () => {
  it("merges locally created durable conversations into navigator items", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.localConversationsById.conv_1 = {
      conversationId: "conv_1",
      title: "Fix sandbox conversation list",
      mode: "coding",
      createdAt: "2026-06-26T12:00:00.000Z",
      updatedAt: "2026-06-26T12:00:01.000Z",
      activeRunIds: ["run_1"],
    };
    const store = { details: { sbx_1: detail } };

    const items = conversationItemsFor(store as never, "sbx_1");

    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind, "durable");
    assert.equal(items[0]?.conversationId, "conv_1");
  });

  it("resolves locally created conversations for workspace tab labels", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.localConversationsById.conv_1 = {
      conversationId: "conv_1",
      title: "Hi How are you?",
      mode: "coding",
      createdAt: "2026-06-26T12:00:00.000Z",
      updatedAt: "2026-06-26T12:00:01.000Z",
      activeRunIds: ["run_1"],
    };
    const store = { details: { sbx_1: detail } };

    assert.equal(
      conversationsFor(store as never, "sbx_1")[0]?.title,
      "Hi How are you?",
    );
    assert.equal(
      sandboxConversationById(detail, "conv_1")?.title,
      "Hi How are you?",
    );
  });

  it("filters composer models to providers reported by the sandbox", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = {
      models: [
        {
          provider: "openai-codex",
          model: "gpt-5.4",
          active: true,
          status: "available",
        },
      ],
    } as unknown as typeof detail.status;

    assert.deepEqual(
      sandboxAvailableModels(managerModels, detail).map(
        (model) => `${model.provider}/${model.modelId}`,
      ),
      ["openai-codex/gpt-5.4"],
    );
  });

  it("includes degraded sandbox providers and excludes unavailable providers", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = {
      models: [
        {
          provider: "openai-codex",
          model: "gpt-5.4",
          active: true,
          status: "degraded",
        },
        {
          provider: "amazon-bedrock",
          model: "nova-lite",
          active: false,
          status: "unavailable",
        },
        {
          provider: "anthropic",
          model: "claude-opus-4.5",
          active: false,
          status: "skipped",
        },
      ],
    } as unknown as typeof detail.status;

    assert.deepEqual(
      sandboxAvailableModels(managerModels, detail).map(
        (model) => model.provider,
      ),
      ["openai-codex"],
    );
  });

  it("falls back to configured snapshot model providers before status reports models", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.snapshot = {
      conversations: [],
      runs: [],
      config: {
        agent: {
          defaultModel: { provider: "anthropic", model: "claude-opus-4.5" },
        },
      },
    } as unknown as typeof detail.snapshot;

    assert.deepEqual(
      sandboxAvailableModels(managerModels, detail).map(
        (model) => model.provider,
      ),
      ["anthropic"],
    );
  });

  it("returns no composer models when the sandbox has not reported providers", () => {
    const detail = createSandboxDetailState("sbx_1");

    assert.deepEqual(sandboxAvailableModels(managerModels, detail), []);
  });

  it("maps sandbox conversation activity to web conversation tones", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.snapshot = {
      conversations: [],
      runs: [
        {
          conversationId: "conv_wait",
          agentId: "agent_main",
          runId: "run_wait",
          status: "waiting_for_input",
        },
        {
          conversationId: "conv_failed",
          agentId: "agent_main",
          runId: "run_failed",
          status: "failed",
        },
      ],
    } as unknown as typeof detail.snapshot;

    assert.deepEqual(
      sandboxConversationActivity(
        {
          conversationId: "conv_plan",
          mode: "planning",
          activeRunIds: ["run_plan"],
        },
        detail,
      ),
      { tone: "good", pulse: true, label: "Planning" },
    );
    assert.deepEqual(
      sandboxConversationActivity(
        {
          conversationId: "conv_code",
          mode: "coding",
          activeRunIds: ["run_code"],
        },
        detail,
      ),
      { tone: "running", pulse: true, label: "Agent running" },
    );
    assert.equal(
      sandboxConversationActivity({ conversationId: "conv_wait" }, detail).tone,
      "warn",
    );
    assert.equal(
      sandboxConversationActivity({ conversationId: "conv_failed" }, detail)
        .tone,
      "danger",
    );
    assert.equal(
      sandboxConversationActivity({ conversationId: "conv_idle" }, detail).tone,
      "neutral",
    );
  });
});
