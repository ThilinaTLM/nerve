import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Api,
  fauxAssistantMessage,
  fauxProvider,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  registerManagedProvider,
  streamSimpleWithModel,
  withNerveSimpleStreamDefaults,
} from "../src/pi-ai-models.js";

function model(api: Api): Model<Api> {
  return {
    id: `test-${api}`,
    name: `Test ${api}`,
    api,
    provider:
      api === "openai-codex-responses" ? "openai-codex" : "test-provider",
    baseUrl: "https://example.com",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_000,
  };
}

async function applyPayload(
  modelValue: Model<Api>,
  options: SimpleStreamOptions | undefined,
  payload: unknown,
): Promise<unknown> {
  const wrapped = withNerveSimpleStreamDefaults(modelValue, options);
  assert.ok(wrapped?.onPayload);
  return await wrapped.onPayload(payload, modelValue);
}

describe("pi-ai model stream defaults", () => {
  it("accepts pre-resolved auth for isolated OAuth-only workers", async () => {
    const faux = fauxProvider({
      provider: "oauth-only",
      models: [{ id: "subscription-model", name: "Subscription Model" }],
    });
    faux.setResponses([fauxAssistantMessage("authenticated")]);
    registerManagedProvider({
      ...faux.provider,
      auth: {
        oauth: {
          name: "OAuth only",
          login: async () => {
            throw new Error("not used");
          },
          refresh: async (credential) => credential,
          toAuth: async (credential) => ({ apiKey: credential.access }),
        },
      },
    });
    const result = await streamSimpleWithModel(
      faux.getModel("subscription-model"),
      {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: "subscription-token" },
    ).result();
    assert.equal(result.stopReason, "stop", result.errorMessage);
  });

  it("requests detailed reasoning summaries from OpenAI Codex", async () => {
    const codex = model("openai-codex-responses");
    const payload = {
      model: "gpt-5.6-sol",
      reasoning: { effort: "high", summary: "auto" },
    };

    const result = await applyPayload(codex, { reasoning: "high" }, payload);

    assert.deepEqual(result, {
      model: "gpt-5.6-sol",
      reasoning: { effort: "high", summary: "detailed" },
    });
    assert.equal(payload.reasoning.summary, "auto");
  });

  it("does not create reasoning when a Codex request has reasoning disabled", async () => {
    const codex = model("openai-codex-responses");
    const payload = { model: "gpt-5.6-sol", input: [] };

    const result = await applyPayload(codex, { reasoning: "off" }, payload);

    assert.equal(result, payload);
    assert.deepEqual(result, payload);
  });

  it("does not wrap non-Codex stream options", () => {
    const openAi = model("openai-responses");
    const options: SimpleStreamOptions = { reasoning: "high" };

    assert.equal(withNerveSimpleStreamDefaults(openAi, options), options);
    assert.equal(withNerveSimpleStreamDefaults(openAi), undefined);
  });

  it("applies the detailed default before calling an existing payload hook", async () => {
    const codex = model("openai-codex-responses");
    let observed: unknown;
    const payload = {
      model: "gpt-5.6-sol",
      reasoning: { effort: "high", summary: "auto" },
    };

    const result = await applyPayload(
      codex,
      {
        onPayload: (nextPayload) => {
          observed = nextPayload;
          return undefined;
        },
      },
      payload,
    );

    assert.deepEqual(observed, {
      model: "gpt-5.6-sol",
      reasoning: { effort: "high", summary: "detailed" },
    });
    assert.deepEqual(result, observed);
  });

  it("allows an existing payload hook to override the detailed default", async () => {
    const codex = model("openai-codex-responses");
    const replacement = {
      model: "gpt-5.6-sol",
      reasoning: { effort: "high", summary: "auto" },
    };

    const result = await applyPayload(
      codex,
      { onPayload: () => replacement },
      {
        model: "gpt-5.6-sol",
        reasoning: { effort: "high", summary: "auto" },
      },
    );

    assert.equal(result, replacement);
  });
});
