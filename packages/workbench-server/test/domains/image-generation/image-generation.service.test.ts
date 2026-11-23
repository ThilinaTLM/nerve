import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ImageGenerateRequest } from "@nervekit/extension-api/host";
import type { ImageGenerationProviderAdapter } from "../../../src/domains/image-generation/image-generation.provider.js";
import { ImageGenerationService } from "../../../src/domains/image-generation/image-generation.service.js";

const request: ImageGenerateRequest = {
  model: { provider: "openai-codex", modelId: "gpt-image-2.5-flare" },
  prompt: "A coral neuron",
  inputs: [],
  options: {},
};

describe("ImageGenerationService", () => {
  it("routes generation through the backend the request names", async () => {
    let received: ImageGenerateRequest | undefined;
    const provider: ImageGenerationProviderAdapter = {
      id: "openai-codex",
      models: () => [{ modelId: "gpt-image-2.5-flare", label: "Flare" }],
      ready: async () => true,
      generate: async (given) => {
        received = given;
        return {
          model: "openai-codex/gpt-image-2.5-flare",
          images: [{ data: new Uint8Array([1, 2, 3]) }],
        };
      },
    };
    const service = new ImageGenerationService([provider]);
    const result = await service.generate(request);
    assert.equal(received, request);
    assert.equal(result.model, "openai-codex/gpt-image-2.5-flare");
    assert.deepEqual(await service.listModels(), [
      {
        provider: "openai-codex",
        modelId: "gpt-image-2.5-flare",
        label: "Flare",
        ready: true,
      },
    ]);
    assert.equal(
      await service.ready({ provider: "openai-codex", modelId: "other" }),
      false,
    );
    await assert.rejects(
      service.generate({
        ...request,
        model: { provider: "openai-codex", modelId: "other" },
      }),
      /Unknown image model/,
    );
  });

  it("rejects a backend without an adapter", async () => {
    await assert.rejects(
      new ImageGenerationService([]).generate(request),
      /Unknown image provider "openai-codex"/,
    );
  });
});
