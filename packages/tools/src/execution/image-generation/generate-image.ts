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

/** Read header dimensions only; unknown/truncated formats retain byte metadata. */
function imageDimensions(
  data: Uint8Array,
  mimeType: string,
): { width?: number; height?: number } {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let width = 0;
  let height = 0;
  if (
    mimeType === "image/png" &&
    bytes.length >= 24 &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        offset += 2;
        continue;
      }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 7
      ) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + length;
    }
  } else if (mimeType === "image/webp") {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = bytes.toString("ascii", offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (start + length > bytes.length) break;
      if (kind === "VP8X" && length >= 10) {
        width = bytes.readUIntLE(start + 4, 3) + 1;
        height = bytes.readUIntLE(start + 7, 3) + 1;
        break;
      }
      if (kind === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
        const bits = bytes.readUInt32LE(start + 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
        break;
      }
      if (
        kind === "VP8 " &&
        length >= 10 &&
        bytes
          .subarray(start + 3, start + 6)
          .equals(Buffer.from([0x9d, 0x01, 0x2a]))
      ) {
        width = bytes.readUInt16LE(start + 6) & 0x3fff;
        height = bytes.readUInt16LE(start + 8) & 0x3fff;
        break;
      }
      offset = start + length + (length % 2);
    }
  }
  return width > 0 && height > 0 ? { width, height } : {};
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
    bytes: number;
    width?: number;
    height?: number;
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
      bytes: image.data.byteLength,
      ...imageDimensions(image.data, mimeType),
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
