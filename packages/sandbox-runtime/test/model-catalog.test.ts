import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SandboxConfigV1 } from "@nervekit/contracts";
import { resolveModelSelection } from "../src/models/model-catalog.js";

function config(provider: string, model: string): SandboxConfigV1 {
  return {
    version: 1,
    agent: { defaultModel: { provider, model } },
    controller: {
      websocket: { url: "ws://127.0.0.1/ws" },
      auth: { type: "api_key", apiKey: { env: "TOKEN" } },
    },
  };
}

describe("model catalog", () => {
  it("accepts OpenAI Codex as a built-in provider", () => {
    const resolved = resolveModelSelection(
      config("openai-codex", "gpt-5.1-codex-max"),
      { provider: "openai-codex", model: "gpt-5.1-codex-max" },
    );

    assert.equal(resolved.builtin, true);
  });
});
