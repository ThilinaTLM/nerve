import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
  ImageBackend,
} from "@nervekit/extension-api";

/** Host side of an image generation backend: credentials and transport. The request carries every option, already validated. */
export interface ImageGenerationProviderAdapter {
  readonly id: ImageBackend;
  generate(request: ImageGenerateRequest): Promise<ImageGenerateResponse>;
}
