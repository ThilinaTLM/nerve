import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
  ImagegenBackend,
} from "@nervekit/quick-script";

/** Host side of an image generation backend: credentials and transport. The request carries every option, already validated. */
export interface ImageGenerationProviderAdapter {
  readonly id: ImagegenBackend;
  generate(request: ImageGenerateRequest): Promise<ImageGenerateResponse>;
}
