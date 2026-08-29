import { Buffer } from "node:buffer";
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import { resizeImage } from "./resize.js";

const ANTHROPIC_MAX_DIMENSION = 8000;
const ANTHROPIC_MANY_IMAGE_MAX_DIMENSION = 2000;
const ANTHROPIC_MANY_IMAGE_THRESHOLD = 20;

interface ModelLike {
  api: string;
}

interface NormalizedContentBlocks {
  blocks: Array<TextContent | ImageContent>;
  changed: boolean;
}

/**
 * Normalize model-visible images for provider request limits without mutating
 * stored transcript messages. Anthropic caps each image dimension at 8000 px,
 * or 2000 px when a request contains more than 20 images.
 */
export async function normalizeImagesForModel(
  messages: Message[],
  model: ModelLike,
): Promise<Message[]> {
  const maxDimension = anthropicMaxDimension(messages, model);
  if (maxDimension === undefined) return messages;

  let changed = false;
  const normalizedMessages: Message[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      if (typeof message.content === "string") {
        normalizedMessages.push(message);
        continue;
      }
      const normalized = await normalizeContentBlocks(
        message.content,
        maxDimension,
      );
      if (normalized.changed) {
        changed = true;
        normalizedMessages.push({ ...message, content: normalized.blocks });
      } else {
        normalizedMessages.push(message);
      }
      continue;
    }

    if (message.role === "toolResult") {
      const normalized = await normalizeContentBlocks(
        message.content,
        maxDimension,
      );
      if (normalized.changed) {
        changed = true;
        normalizedMessages.push({ ...message, content: normalized.blocks });
      } else {
        normalizedMessages.push(message);
      }
      continue;
    }

    normalizedMessages.push(message);
  }

  return changed ? normalizedMessages : messages;
}

function anthropicMaxDimension(
  messages: Message[],
  model: ModelLike,
): number | undefined {
  if (model.api !== "anthropic-messages" && model.api !== "anthropic") {
    return undefined;
  }
  return countImages(messages) > ANTHROPIC_MANY_IMAGE_THRESHOLD
    ? ANTHROPIC_MANY_IMAGE_MAX_DIMENSION
    : ANTHROPIC_MAX_DIMENSION;
}

function countImages(messages: Message[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role === "user") {
      if (typeof message.content === "string") continue;
      count += message.content.filter(isImageContent).length;
      continue;
    }
    if (message.role === "toolResult") {
      count += message.content.filter(isImageContent).length;
    }
  }
  return count;
}

async function normalizeContentBlocks(
  blocks: readonly (TextContent | ImageContent)[],
  maxDimension: number,
): Promise<NormalizedContentBlocks> {
  let changed = false;
  const normalizedBlocks: Array<TextContent | ImageContent> = [];

  for (const block of blocks) {
    if (!isImageContent(block)) {
      normalizedBlocks.push(block);
      continue;
    }

    const normalized = await normalizeImageBlock(block, maxDimension);
    if (normalized !== block) changed = true;
    normalizedBlocks.push(normalized);
  }

  return { blocks: normalizedBlocks, changed };
}

async function normalizeImageBlock(
  image: ImageContent,
  maxDimension: number,
): Promise<ImageContent> {
  try {
    const source = Buffer.from(image.data, "base64");
    const dimensions = readImageDimensions(source);
    if (
      dimensions &&
      dimensions.width <= maxDimension &&
      dimensions.height <= maxDimension
    ) {
      return image;
    }

    const resized = await resizeImage(source, image.mimeType, maxDimension);
    if (!resized.changed) return image;
    return {
      type: "image",
      data: resized.buffer.toString("base64"),
      mimeType: resized.mimeType,
    };
  } catch {
    return image;
  }
}

function readImageDimensions(
  source: Buffer,
): { width: number; height: number } | undefined {
  if (source.length >= 24 && source.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      width: source.readUInt32BE(16),
      height: source.readUInt32BE(20),
    };
  }

  const jpeg = readJpegDimensions(source);
  if (jpeg) return jpeg;

  const webp = readWebpDimensions(source);
  if (webp) return webp;

  return undefined;
}

function readJpegDimensions(
  source: Buffer,
): { width: number; height: number } | undefined {
  if (source.length < 4 || source[0] !== 0xff || source[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 3 < source.length) {
    if (source[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = source[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 1 >= source.length) return undefined;
    const segmentLength = source.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > source.length) {
      return undefined;
    }
    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      return {
        height: source.readUInt16BE(offset + 3),
        width: source.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }

  return undefined;
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function readWebpDimensions(
  source: Buffer,
): { width: number; height: number } | undefined {
  if (
    source.length < 30 ||
    source.toString("ascii", 0, 4) !== "RIFF" ||
    source.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return undefined;
  }

  const chunk = source.toString("ascii", 12, 16);
  if (chunk === "VP8X" && source.length >= 30) {
    return {
      width: 1 + source.readUIntLE(24, 3),
      height: 1 + source.readUIntLE(27, 3),
    };
  }

  if (chunk === "VP8 " && source.length >= 30) {
    return {
      width: source.readUInt16LE(26) & 0x3fff,
      height: source.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === "VP8L" && source.length >= 25 && source[20] === 0x2f) {
    const bits = source.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return undefined;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function isImageContent(
  block: TextContent | ImageContent,
): block is ImageContent {
  return block.type === "image";
}
