import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ImageGenerateRequest } from "@nervekit/extension-api/host";
import type { AuthManager } from "../../auth/index.js";
import { OpenAiCodexImageGenerationProvider } from "./openai-codex-image-generation.provider.js";

const forbiddenFetch = (() => {
  throw new Error("network must not be reached");
}) as unknown as typeof fetch;

function provider(): OpenAiCodexImageGenerationProvider {
  return new OpenAiCodexImageGenerationProvider(
    {} as AuthManager,
    undefined,
    forbiddenFetch,
  );
}

function request(
  overrides: Partial<ImageGenerateRequest> = {},
): ImageGenerateRequest {
  return {
    model: { provider: "openai-codex", modelId: "gpt-image-2.5-flare" },
    prompt: "a cat",
    inputs: [],
    options: {},
    ...overrides,
  };
}

void describe("openai-codex image provider validation", () => {
  void it("rejects a bad size, unknown model and inputs before any network call", async () => {
    for (const bad of [
      request({ options: { size: "1000x1000" } }),
      request({ options: { quality: "ultra" } }),
      request({ model: { provider: "openai-codex", modelId: "nope" } }),
      request({
        inputs: [{ data: new Uint8Array([1]), mimeType: "image/png" }],
      }),
    ])
      await assert.rejects(
        provider().generate(bad),
        (error: { code?: string }) => error.code === "BAD_REQUEST",
      );
  });

  void it("defaults absent options to auto", async () => {
    let body: Record<string, unknown> = {};
    const fake = (async (_url: unknown, init: { body: string }) => {
      body = JSON.parse(init.body) as Record<string, unknown>;
      return new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const auth = {
      getCredential: async () => ({ type: "oauth" }),
      getApiKey: async () => fakeToken,
    } as unknown as AuthManager;
    const result = await new OpenAiCodexImageGenerationProvider(
      auth,
      undefined,
      fake,
    ).generate(request({ options: { size: "1536x1024" } }));
    assert.equal(body.quality, "auto");
    assert.equal(body.background, "auto");
    assert.equal(body.size, "1536x1024");
    assert.equal(result.model, "openai-codex/gpt-image-2.5-flare");
  });
});

const fakeToken = `x.${Buffer.from(
  JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "acct" },
  }),
).toString("base64url")}.y`;
