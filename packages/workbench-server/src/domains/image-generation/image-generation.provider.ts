import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
} from "@nervekit/extension-api/host";

/** Host side of an image generation backend: credentials and transport. The request carries every option, already validated. */
export interface ImageGenerationProviderAdapter {
  readonly id: string;
  generate(request: ImageGenerateRequest): Promise<ImageGenerateResponse>;
}
