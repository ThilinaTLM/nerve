import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { AuthManager } from "../../../src/domains/auth/index.js";
import { OpenAiCodexImageGenerationProvider } from "../../../src/domains/image-generation/providers/openai-codex-image-generation.provider.js";

function accessToken(accountId = "account-test"): string {
  const claims = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
  ).toString("base64url");
  return `header.${claims}.signature`;
}

const request = { prompt: "A coral nerve cell" };
const settings = {
  provider: "openai-codex" as const,
  model: "gpt-image-2.5-flare" as const,
  options: {
    quality: "xhigh" as const,
    size: "1024x1024" as const,
    background: "transparent" as const,
  },
};

function auth(): AuthManager {
  return {
    getCredential: async () => ({
      type: "oauth",
      access: accessToken(),
      refresh: "refresh",
      expires: Date.now() + 60_000,
    }),
    getApiKey: async () => accessToken(),
  } as AuthManager;
}

describe("OpenAI Codex image generation provider", () => {
  it("sends current model options with Codex OAuth and decodes images", async () => {
    const image = Buffer.from("image-bytes");
    const fetchMock = mock.method(globalThis, "fetch", async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("ChatGPT-Account-ID"), "account-test");
      assert.match(headers.get("Authorization") ?? "", /^Bearer /);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "gpt-image-2.5-flare",
        prompt: "A coral nerve cell",
        quality: "xhigh",
        size: "1024x1024",
        background: "transparent",
        n: 1,
      });
      return new Response(
        JSON.stringify({
          data: [
            {
              b64_json: image.toString("base64"),
              revised_prompt: "A refined coral nerve cell",
            },
          ],
        }),
        { status: 200 },
      );
    });
    let usageTouches = 0;
    try {
      const provider = new OpenAiCodexImageGenerationProvider(
        auth(),
        () => (usageTouches += 1),
      );
      const response = await provider.generate(request, settings);
      assert.equal(response.provider, "openai-codex");
      assert.equal(response.model, "gpt-image-2.5-flare");
      assert.deepEqual(Buffer.from(response.images[0]!.data), image);
      assert.equal(
        response.images[0]?.revisedPrompt,
        "A refined coral nerve cell",
      );
      assert.equal(usageTouches, 1);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("requires OAuth rather than an OpenAI API key", async () => {
    const provider = new OpenAiCodexImageGenerationProvider({
      getCredential: async () => ({ type: "api_key", key: "key" }),
    } as AuthManager);
    await assert.rejects(
      provider.generate(request, settings),
      /requires an OAuth connection/,
    );
  });
});
