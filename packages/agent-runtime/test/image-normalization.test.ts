import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import type { ImageContent, Message } from "@earendil-works/pi-ai";
import sharp from "sharp";
import { normalizeImagesForModel } from "../src/runtime/image-normalization.js";

async function pngImage(width: number, height: number): Promise<ImageContent> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 32, g: 96, b: 160 },
    },
  })
    .png()
    .toBuffer();
  return {
    type: "image",
    data: buffer.toString("base64"),
    mimeType: "image/png",
  };
}

async function dimensions(image: ImageContent): Promise<{
  width: number;
  height: number;
}> {
  const metadata = await sharp(Buffer.from(image.data, "base64")).metadata();
  assert.equal(typeof metadata.width, "number");
  assert.equal(typeof metadata.height, "number");
  return { width: metadata.width, height: metadata.height };
}

function imageBlocks(message: Message): ImageContent[] {
  if (message.role === "assistant" || typeof message.content === "string") {
    return [];
  }
  return message.content.filter(
    (block): block is ImageContent => block.type === "image",
  );
}

describe("image normalization", () => {
  it("resizes oversized images for Anthropic many-image requests", async () => {
    const oversized = await pngImage(2600, 1800);
    const small = await pngImage(120, 80);
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "text", text: "compare" }, oversized, small],
        timestamp: 1,
      },
    ];

    const normalized = await normalizeImagesForModel(messages, {
      api: "anthropic-messages",
    });

    assert.notEqual(normalized, messages);
    assert.notEqual(normalized[0], messages[0]);
    assert.equal(imageBlocks(messages[0]).at(0)?.data, oversized.data);

    const [normalizedOversized, normalizedSmall] = imageBlocks(normalized[0]);
    assert.ok(normalizedOversized);
    assert.ok(normalizedSmall);
    assert.notEqual(normalizedOversized.data, oversized.data);
    assert.equal(normalizedSmall.data, small.data);

    const resizedDimensions = await dimensions(normalizedOversized);
    assert.ok(resizedDimensions.width <= 2000);
    assert.ok(resizedDimensions.height <= 2000);
  });

  it("leaves a single oversized Anthropic image unchanged", async () => {
    const oversized = await pngImage(2600, 1800);
    const messages: Message[] = [
      { role: "user", content: [oversized], timestamp: 1 },
    ];

    const normalized = await normalizeImagesForModel(messages, {
      api: "anthropic-messages",
    });

    assert.equal(normalized, messages);
  });

  it("leaves non-Anthropic many-image requests unchanged", async () => {
    const oversized = await pngImage(2600, 1800);
    const small = await pngImage(120, 80);
    const messages: Message[] = [
      { role: "user", content: [oversized, small], timestamp: 1 },
    ];

    const normalized = await normalizeImagesForModel(messages, {
      api: "openai-responses",
    });

    assert.equal(normalized, messages);
  });
});
