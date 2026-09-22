import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ImageGenerationProviderAdapter } from "../../../src/domains/image-generation/image-generation.provider.js";
import { ImageGenerationService } from "../../../src/domains/image-generation/image-generation.service.js";

const settings = {
  provider: "openai-codex" as const,
  model: "gpt-image-2.5-flare" as const,
  options: {
    quality: "auto" as const,
    size: "auto" as const,
    background: "auto" as const,
  },
};

describe("ImageGenerationService", () => {
  it("routes generation and readiness through the selected provider", async () => {
    let receivedPrompt: string | undefined;
    const provider: ImageGenerationProviderAdapter = {
      id: "openai-codex",
      isAvailable: async () => true,
      generate: async (request, receivedSettings) => {
        receivedPrompt = request.prompt;
        assert.equal(receivedSettings, settings);
        return {
          provider: "openai-codex",
          model: "gpt-image-2.5-flare",
          images: [{ data: new Uint8Array([1, 2, 3]) }],
        };
      },
    };
    const service = new ImageGenerationService([provider]);

    assert.equal(await service.isAvailable(settings), true);
    const result = await service.generate(
      { prompt: "A coral neuron" },
      settings,
    );

    assert.equal(receivedPrompt, "A coral neuron");
    assert.equal(result.provider, "openai-codex");
  });
});
