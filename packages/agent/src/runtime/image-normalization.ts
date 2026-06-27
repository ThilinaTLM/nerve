import { Buffer } from "node:buffer";
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import sharp from "sharp";

const ANTHROPIC_MANY_IMAGE_MAX_DIMENSION = 2000;

interface ModelLike {
  api: string;
}

interface NormalizedContentBlocks {
  blocks: Array<TextContent | ImageContent>;
  changed: boolean;
}

/**
 * Normalize model-visible images for provider request limits without mutating
 * stored transcript messages. Anthropic allows larger single-image requests,
 * but caps every image dimension at 2000 px when a request contains many images.
 */
export async function normalizeImagesForModel(
  messages: Message[],
  model: ModelLike,
): Promise<Message[]> {
  if (!requiresAnthropicManyImageCap(messages, model)) return messages;

  let changed = false;
  const normalizedMessages: Message[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      if (typeof message.content === "string") {
        normalizedMessages.push(message);
        continue;
      }
      const normalized = await normalizeContentBlocks(message.content);
      if (normalized.changed) {
        changed = true;
        normalizedMessages.push({ ...message, content: normalized.blocks });
      } else {
        normalizedMessages.push(message);
      }
      continue;
    }

    if (message.role === "toolResult") {
      const normalized = await normalizeContentBlocks(message.content);
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

function requiresAnthropicManyImageCap(
  messages: Message[],
  model: ModelLike,
): boolean {
  if (model.api !== "anthropic-messages" && model.api !== "anthropic") {
    return false;
  }
  return countImages(messages) > 1;
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
): Promise<NormalizedContentBlocks> {
  let changed = false;
  const normalizedBlocks: Array<TextContent | ImageContent> = [];

  for (const block of blocks) {
    if (!isImageContent(block)) {
      normalizedBlocks.push(block);
      continue;
    }

    const normalized = await normalizeImageBlock(block);
    if (normalized !== block) changed = true;
    normalizedBlocks.push(normalized);
  }

  return { blocks: normalizedBlocks, changed };
}

async function normalizeImageBlock(image: ImageContent): Promise<ImageContent> {
  try {
    const source = Buffer.from(image.data, "base64");
    const metadata = await sharp(source).metadata();
    if (!metadata.width || !metadata.height) return image;
    if (
      metadata.width <= ANTHROPIC_MANY_IMAGE_MAX_DIMENSION &&
      metadata.height <= ANTHROPIC_MANY_IMAGE_MAX_DIMENSION
    ) {
      return image;
    }

    const resized = sharp(source).resize({
      width: ANTHROPIC_MANY_IMAGE_MAX_DIMENSION,
      height: ANTHROPIC_MANY_IMAGE_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });
    const encoded = await encodeResizedImage(resized, image.mimeType);
    return {
      type: "image",
      data: encoded.buffer.toString("base64"),
      mimeType: encoded.mimeType,
    };
  } catch {
    return image;
  }
}

async function encodeResizedImage(
  image: sharp.Sharp,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return { buffer: await image.jpeg().toBuffer(), mimeType: "image/jpeg" };
    case "image/png":
      return { buffer: await image.png().toBuffer(), mimeType: "image/png" };
    case "image/webp":
      return { buffer: await image.webp().toBuffer(), mimeType: "image/webp" };
    default:
      return { buffer: await image.png().toBuffer(), mimeType: "image/png" };
  }
}

function isImageContent(
  block: TextContent | ImageContent,
): block is ImageContent {
  return block.type === "image";
}
