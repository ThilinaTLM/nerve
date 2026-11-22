import { ExtensionError } from "@nervekit/extension-api";
import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
} from "@nervekit/extension-api/host";
import type { ImageModelSelection } from "@nervekit/extension-api";
import type { ImageGenerationProviderAdapter } from "./image-generation.provider.js";

/** The image models a host offers, with whether their provider is signed in. */
export type ImageModelListing = {
  provider: string;
  modelId: string;
  label: string;
  ready: boolean;
};

export class ImageGenerationService {
  private readonly providers: Map<string, ImageGenerationProviderAdapter>;

  constructor(providers: readonly ImageGenerationProviderAdapter[]) {
    this.providers = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
  }

  async generate(
    request: ImageGenerateRequest,
  ): Promise<ImageGenerateResponse> {
    const { provider: id, modelId } = request.model;
    const provider = this.providers.get(id);
    if (!provider)
      throw new ExtensionError(
        "BAD_REQUEST",
        `Unknown image provider "${id}"; valid: ${[...this.providers.keys()].join(", ")}.`,
      );
    if (!provider.models().some((model) => model.modelId === modelId))
      throw new ExtensionError(
        "BAD_REQUEST",
        `Unknown image model "${modelId}" for provider ${id}; valid: ${provider
          .models()
          .map((model) => model.modelId)
          .join(", ")}.`,
      );
    return provider.generate(request);
  }

  async ready(model: ImageModelSelection): Promise<boolean> {
    const provider = this.providers.get(model.provider);
    if (!provider?.models().some((entry) => entry.modelId === model.modelId))
      return false;
    return provider.ready();
  }

  async listModels(): Promise<ImageModelListing[]> {
    return (
      await Promise.all(
        [...this.providers.values()].map(async (provider) => {
          const ready = await provider.ready();
          return provider.models().map((model) => ({
            provider: provider.id,
            ...model,
            ready,
          }));
        }),
      )
    ).flat();
  }
}
