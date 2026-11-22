import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
} from "@nervekit/extension-api/host";

/**
 * Host side of an image generation backend: credentials, transport and the
 * validation of the options its models accept. `generate` throws
 * `ExtensionError("BAD_REQUEST")` naming the valid values before any network call.
 */
export interface ImageGenerationProviderAdapter {
  readonly id: string;
  /** The models this provider offers. */
  models(): { modelId: string; label: string }[];
  /** Whether the provider is signed in. */
  ready(): Promise<boolean>;
  generate(request: ImageGenerateRequest): Promise<ImageGenerateResponse>;
}
