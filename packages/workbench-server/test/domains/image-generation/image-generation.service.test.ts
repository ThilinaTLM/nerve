import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ImageGenerateRequest } from "@nervekit/extension-api";
import type { ImageGenerationProviderAdapter } from "../../../src/domains/image-generation/image-generation.provider.js";
import { ImageGenerationService } from "../../../src/domains/image-generation/image-generation.service.js";

const request: ImageGenerateRequest = {
  prompt: "A coral neuron",
  inputs: [],
  options: {
    backend: "openai-codex",
    model: "gpt-image-2.5-flare",
    quality: "auto",
    size: "auto",
    background: "auto",
  },
};

describe("ImageGenerationService", () => {
  it("routes generation through the backend the request names", async () => {
    let received: ImageGenerateRequest | undefined;
    const provider: ImageGenerationProviderAdapter = {
      id: "openai-codex",
      generate: async (given) => {
        received = given;
        return {
          provider: "openai-codex",
          model: "gpt-image-2.5-flare",
          images: [{ data: new Uint8Array([1, 2, 3]) }],
        };
      },
    };
    const result = await new ImageGenerationService([provider]).generate(
      request,
    );
    assert.equal(received, request);
    assert.equal(result.provider, "openai-codex");
  });

  it("rejects a backend without an adapter", async () => {
    await assert.rejects(
      new ImageGenerationService([]).generate(request),
      /backend openai-codex is unavailable/,
    );
  });
});
