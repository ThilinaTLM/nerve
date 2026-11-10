import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import { image as nativeImage } from "@nervekit/native";
import {
  imagePolicyForModel,
  type ImageModelLike,
  type ImagePolicy,
} from "./policy.js";

type Block = TextContent | ImageContent;

type Outcome =
  | { kind: "unchanged" }
  | { kind: "prepared"; image: ImageContent }
  | { kind: "failed"; reason: string };

/**
 * Normalize model-visible images for the model's provider limits without
 * mutating stored transcript messages. An image that cannot be prepared is
 * replaced by a text placeholder so the run (and every later turn that still
 * carries the image in history) keeps working.
 */
export async function normalizeImagesForModel(
  messages: Message[],
  model: ImageModelLike,
): Promise<Message[]> {
  const imageCount = countImages(messages);
  if (imageCount === 0) return messages;
  const policy = imagePolicyForModel(model, imageCount);

  let changed = false;
  const result: Message[] = [];
  for (const message of messages) {
    if (
      (message.role === "user" && typeof message.content !== "string") ||
      message.role === "toolResult"
    ) {
      const blocks = await normalizeBlocks(
        message.content as readonly Block[],
        policy,
      );
      if (blocks) {
        changed = true;
        result.push({ ...message, content: blocks });
        continue;
      }
    }
    result.push(message);
  }
  return changed ? result : messages;
}

/** Returns new blocks, or undefined when nothing changed. */
async function normalizeBlocks(
  blocks: readonly Block[],
  policy: ImagePolicy,
): Promise<Block[] | undefined> {
  let changed = false;
  const out: Block[] = [];
  for (const block of blocks) {
    if (!isImageContent(block)) {
      out.push(block);
      continue;
    }
    const outcome = await prepareCached(block, policy);
    if (outcome.kind === "unchanged") {
      out.push(block);
      continue;
    }
    changed = true;
    out.push(
      outcome.kind === "prepared"
        ? outcome.image
        : { type: "text", text: omittedText(block, outcome.reason) },
    );
  }
  return changed ? out : undefined;
}

function omittedText(image: ImageContent, reason: string): string {
  const dimensions = readImageDimensions(Buffer.from(image.data, "base64"));
  const size = dimensions ? `${dimensions.width}x${dimensions.height} ` : "";
  return `[Image omitted: could not be prepared for this model (${size}${image.mimeType.slice(0, 100)}): ${reason}]`;
}

// Small bounded LRU so history images are not re-processed on every turn.
const CACHE_MAX_ENTRIES = 64;
const CACHE_MAX_CHARS = 96 * 1024 * 1024;
const cache = new Map<string, { outcome: Outcome; size: number }>();
let cacheChars = 0;

async function prepareCached(
  image: ImageContent,
  policy: ImagePolicy,
): Promise<Outcome> {
  const key = `${createHash("sha256").update(image.data).digest("hex")}:${policy.key}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.outcome;
  }
  const outcome = await prepare(image, policy);
  const size = outcome.kind === "prepared" ? outcome.image.data.length : 0;
  cache.set(key, { outcome, size });
  cacheChars += size;
  for (const [oldest, entry] of cache) {
    if (cache.size <= CACHE_MAX_ENTRIES && cacheChars <= CACHE_MAX_CHARS) break;
    cache.delete(oldest);
    cacheChars -= entry.size;
  }
  return outcome;
}

async function prepare(
  image: ImageContent,
  policy: ImagePolicy,
): Promise<Outcome> {
  try {
    const prepared = await nativeImage.prepareImage(
      Buffer.from(image.data, "base64"),
      policy,
    );
    if (!prepared.changed) {
      // Providers reject a declared media type that does not match the bytes.
      return normalizeMimeType(image.mimeType) === prepared.mimeType
        ? { kind: "unchanged" }
        : {
            kind: "prepared",
            image: { ...image, mimeType: prepared.mimeType },
          };
    }
    return {
      kind: "prepared",
      image: {
        type: "image",
        data: prepared.data.toString("base64"),
        mimeType: prepared.mimeType,
      },
    };
  } catch (error) {
    console.error(
      `Could not prepare image (${image.mimeType.slice(0, 100)}) for ${policy.key}`,
      error,
    );
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "failed", reason: reason.slice(0, 200) };
  }
}

function normalizeMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function countImages(messages: Message[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role === "assistant" || typeof message.content === "string") {
      continue;
    }
    count += message.content.filter(isImageContent).length;
  }
  return count;
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
