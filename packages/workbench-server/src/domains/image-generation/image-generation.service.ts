import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
} from "@nervekit/extensions";
import { ApplicationError } from "../../core/application-error.js";
import type { ImageGenerationProviderAdapter } from "./image-generation.provider.js";

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
    const provider = this.providers.get(request.options.backend);
    if (!provider) {
      throw new ApplicationError(
        400,
        "IMAGE_GENERATION_PROVIDER_UNAVAILABLE",
        `Image generation backend ${request.options.backend} is unavailable.`,
      );
    }
    return provider.generate(request);
  }
}
