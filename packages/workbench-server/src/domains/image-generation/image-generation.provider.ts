import type {
  ImageGenerationProvider,
  ImageGenerationToolSettings,
} from "@nervekit/contracts/settings";
import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
} from "@nervekit/tools/execution";

export interface ImageGenerationProviderAdapter {
  readonly id: ImageGenerationProvider;
  isAvailable(): Promise<boolean>;
  generate(
    request: ImageGenerateRequest,
    settings: ImageGenerationToolSettings,
  ): Promise<ImageGenerateResponse>;
}
