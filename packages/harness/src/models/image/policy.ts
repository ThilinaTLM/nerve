import type { image } from "@nervekit/native";

export interface ImageModelLike {
  api: string;
  id?: string;
  provider?: string;
}

export interface ImagePolicy extends image.PrepareImageOptions {
  acceptedFormats: readonly image.ImageFormat[];
  outputFormats: readonly image.ImageOutputFormat[];
  /** Stable identity for cache keys and logs. */
  key: string;
}

const MANY_IMAGE_THRESHOLD = 20;

type Limits = Omit<ImagePolicy, "key">;

const ALL_FORMATS = ["png", "jpeg", "gif", "webp"] as const;
// Animated or not, gif is only passed through where documented as accepted.
const COMMON_FORMATS = ["png", "jpeg", "webp"] as const;
const OUTPUT = ["png", "jpeg"] as const;

/**
 * Per-provider image limits (2026 docs). Sizes are base64 bytes.
 * - anthropic family (also any `claude` model behind a proxy or Bedrock):
 *   8000px, or 2000px with more than 20 images in the request; 5 MB is the
 *   strictest per-image size (Bedrock).
 * - bedrock, non-Claude: 8000px, 3.75 MB raw ≈ 5 MB base64.
 * - openai: images are fitted to 2048px; 10 MB per image is well under limits.
 * - google: no gif; inline requests are about 20 MB in total, so 5 MB each.
 * - default (unknown / OpenAI-compatible): 2048px, 4 MB.
 */
export function imagePolicyForModel(
  model: ImageModelLike,
  imageCount: number,
): ImagePolicy {
  const family = familyOf(model);
  const limits = familyLimits(family, imageCount);
  return { ...limits, key: `${family}:${JSON.stringify(limits)}` };
}

function familyOf(model: ImageModelLike): string {
  const id = model.id?.toLowerCase() ?? "";
  if (
    model.api === "anthropic-messages" ||
    model.api === "anthropic" ||
    id.includes("claude")
  ) {
    return "anthropic";
  }
  switch (model.api) {
    case "bedrock-converse-stream":
      return "bedrock";
    case "openai-responses":
    case "azure-openai-responses":
    case "openai-codex-responses":
      return "openai";
    case "google-generative-ai":
    case "google-vertex":
      return "google";
    default:
      return "default";
  }
}

function familyLimits(family: string, imageCount: number): Limits {
  switch (family) {
    case "anthropic":
      return {
        maxDimension: imageCount > MANY_IMAGE_THRESHOLD ? 2000 : 8000,
        maxBase64Bytes: 5_000_000,
        acceptedFormats: ALL_FORMATS,
        outputFormats: OUTPUT,
      };
    case "bedrock":
      return {
        maxDimension: 8000,
        maxBase64Bytes: 5_000_000,
        acceptedFormats: ALL_FORMATS,
        outputFormats: OUTPUT,
      };
    case "openai":
      return {
        maxDimension: 2048,
        maxBase64Bytes: 10_000_000,
        acceptedFormats: COMMON_FORMATS,
        outputFormats: OUTPUT,
      };
    case "google":
      return {
        maxDimension: 4096,
        maxBase64Bytes: 5_000_000,
        acceptedFormats: COMMON_FORMATS,
        outputFormats: OUTPUT,
      };
    default:
      return {
        maxDimension: 2048,
        maxBase64Bytes: 4_000_000,
        acceptedFormats: COMMON_FORMATS,
        outputFormats: OUTPUT,
      };
  }
}
