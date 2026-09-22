import type { ImageGenerationToolSettings } from "@nervekit/contracts/settings";
import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
} from "@nervekit/tools/execution";
import { ApplicationError } from "../../core/application-error.js";
import type { ImageGenerationProviderAdapter } from "./image-generation.provider.js";

export class ImageGenerationService {
  private readonly providers: Map<string, ImageGenerationProviderAdapter>;

  constructor(providers: readonly ImageGenerationProviderAdapter[]) {
    this.providers = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
  }

  async isAvailable(settings: ImageGenerationToolSettings): Promise<boolean> {
    return (
      (await this.providers.get(settings.provider)?.isAvailable()) ?? false
    );
  }

  async generate(
    request: ImageGenerateRequest,
    settings: ImageGenerationToolSettings,
  ): Promise<ImageGenerateResponse> {
    const provider = this.providers.get(settings.provider);
    if (!provider) {
      throw new ApplicationError(
        400,
        "IMAGE_GENERATION_PROVIDER_UNAVAILABLE",
        `Image generation provider ${settings.provider} is unavailable.`,
      );
    }
    return provider.generate(request, settings);
  }
}
