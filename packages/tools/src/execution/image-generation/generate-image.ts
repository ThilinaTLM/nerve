import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ImageGenerationExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { detectSupportedImageMimeType } from "../filesystem/read.js";

const MAX_PROMPT_CHARS = 32_000;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

function requiredPrompt(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("prompt must be a non-empty string.");
  }
  const prompt = value.trim();
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`prompt must not exceed ${MAX_PROMPT_CHARS} characters.`);
  }
  return prompt;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export async function executeGenerateImage(
  args: Record<string, unknown>,
  context: ImageGenerationExecutionContext,
): Promise<ToolExecutionResult> {
  if (!context.generateImage) {
    throw new Error("Image generation is not configured in Settings.");
  }
  if (!context.artifactDir) {
    throw new Error("Image generation requires an artifact output directory.");
  }

  const prompt = requiredPrompt(args.prompt);
  const response = await context.generateImage({
    prompt,
    signal: context.signal,
  });
  if (response.images.length === 0) {
    throw new Error("The image provider returned no images.");
  }

  await mkdir(context.artifactDir, { recursive: true });
  const images: Array<{
    path: string;
    mimeType: string;
    byteSize: number;
    revisedPrompt?: string;
  }> = [];
  for (const [index, image] of response.images.entries()) {
    if (
      image.data.byteLength === 0 ||
      image.data.byteLength > MAX_IMAGE_BYTES
    ) {
      throw new Error(
        `Image output ${index + 1} has an invalid size (${image.data.byteLength} bytes).`,
      );
    }
    const mimeType = detectSupportedImageMimeType(image.data);
    if (
      !mimeType ||
      !["image/png", "image/jpeg", "image/webp"].includes(mimeType)
    ) {
      throw new Error(
        `Image output ${index + 1} has an unsupported image format.`,
      );
    }
    const path = join(
      context.artifactDir,
      `generated-${index + 1}.${extensionForMimeType(mimeType)}`,
    );
    await writeFile(path, image.data);
    images.push({
      path,
      mimeType,
      byteSize: image.data.byteLength,
      ...(image.revisedPrompt ? { revisedPrompt: image.revisedPrompt } : {}),
    });
  }

  const summary = `Generated ${images.length} image${images.length === 1 ? "" : "s"} with ${response.model}.`;
  return {
    content: summary,
    contentBlocks: [{ type: "text", text: summary }],
    details: {
      provider: response.provider,
      model: response.model,
      prompt,
      images,
      outputLimits: {
        artifacts: images.map((image, index) => ({
          role: "primary_result" as const,
          path: image.path,
          format: { kind: "image" as const, mediaType: image.mimeType },
          bytes: image.byteSize,
          label: `Generated image ${index + 1}`,
          recommendedTools: ["read", "explain_image"] as const,
        })),
      },
    },
  };
}
