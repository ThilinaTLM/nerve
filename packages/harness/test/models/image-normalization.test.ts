import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import type { ImageContent, Message } from "@earendil-works/pi-ai";
import sharp from "sharp";
import { normalizeImagesForModel } from "../../src/models/image/normalization.js";

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
  it("resizes a single Anthropic image that exceeds 8000 px", async () => {
    const oversized = await pngImage(190, 8101);
    const message: Message = {
      role: "toolResult",
      toolCallId: "read-image",
      toolName: "read",
      content: [{ type: "text", text: "Read image file" }, oversized],
      isError: false,
      timestamp: 1,
    };
    const messages = [message];

    const normalized = await normalizeImagesForModel(messages, {
      api: "anthropic-messages",
    });

    assert.notEqual(normalized, messages);
    assert.notEqual(normalized[0], message);
    assert.equal(messages[0], message);
    assert.equal(imageBlocks(message)[0]?.data, oversized.data);

    const normalizedImage = imageBlocks(normalized[0])[0];
    assert.ok(normalizedImage);
    assert.notEqual(normalizedImage.data, oversized.data);
    const resizedDimensions = await dimensions(normalizedImage);
    assert.ok(resizedDimensions.width <= 8000);
    assert.ok(resizedDimensions.height <= 8000);
  });

  it("leaves up to 20 compliant Anthropic images unchanged", async () => {
    const image = await pngImage(2600, 1800);
    const messages: Message[] = [
      {
        role: "user",
        content: Array.from({ length: 20 }, () => image),
        timestamp: 1,
      },
    ];

    const normalized = await normalizeImagesForModel(messages, {
      api: "anthropic-messages",
    });

    assert.equal(normalized, messages);
  });

  it("keeps images exactly at Anthropic dimension boundaries", async () => {
    const singleBoundary = await pngImage(10, 8000);
    const manyBoundary = await pngImage(2000, 10);
    const small = await pngImage(12, 8);
    const singleMessages: Message[] = [
      { role: "user", content: [singleBoundary], timestamp: 1 },
    ];
    const manyMessages: Message[] = [
      {
        role: "user",
        content: [manyBoundary, ...Array.from({ length: 20 }, () => small)],
        timestamp: 1,
      },
    ];

    assert.equal(
      await normalizeImagesForModel(singleMessages, {
        api: "anthropic-messages",
      }),
      singleMessages,
    );
    assert.equal(
      await normalizeImagesForModel(manyMessages, {
        api: "anthropic-messages",
      }),
      manyMessages,
    );
  });

  it("caps images at 2000 px when an Anthropic request has over 20", async () => {
    const oversized = await pngImage(2600, 1800);
    const small = await pngImage(12, 8);
    const messages: Message[] = [
      {
        role: "user",
        content: [oversized, ...Array.from({ length: 20 }, () => small)],
        timestamp: 1,
      },
    ];

    const normalized = await normalizeImagesForModel(messages, {
      api: "anthropic-messages",
    });

    assert.notEqual(normalized, messages);
    const normalizedImages = imageBlocks(normalized[0]);
    assert.equal(normalizedImages.length, 21);
    assert.notEqual(normalizedImages[0]?.data, oversized.data);
    assert.equal(normalizedImages[1]?.data, small.data);

    const resizedDimensions = await dimensions(normalizedImages[0]);
    assert.ok(resizedDimensions.width <= 2000);
    assert.ok(resizedDimensions.height <= 2000);
  });

  it("renormalizes an older image when a later image crosses the many-image threshold", async () => {
    const olderOversized = await pngImage(1400, 2600);
    const small = await pngImage(12, 8);
    const olderMessage: Message = {
      role: "toolResult",
      toolCallId: "older-read",
      toolName: "read",
      content: [{ type: "text", text: "Read image file" }, olderOversized],
      isError: false,
      timestamp: 1,
    };
    const messages: Message[] = [
      olderMessage,
      {
        role: "user",
        content: Array.from({ length: 20 }, () => small),
        timestamp: 2,
      },
    ];

    const normalized = await normalizeImagesForModel(messages, {
      api: "anthropic-messages",
    });

    const normalizedImage = imageBlocks(normalized[0])[0];
    assert.ok(normalizedImage);
    assert.deepEqual(await dimensions(normalizedImage), {
      width: 1077,
      height: 2000,
    });
    assert.equal(imageBlocks(olderMessage)[0]?.data, olderOversized.data);
    assert.notEqual(normalized[0], olderMessage);
    assert.equal(normalized[1], messages[1]);
  });

  it("fails closed with image position and limit when resizing fails", async () => {
    const malformed = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
      malformed,
    );
    malformed.writeUInt32BE(2600, 16);
    malformed.writeUInt32BE(1400, 20);
    const image: ImageContent = {
      type: "image",
      data: malformed.toString("base64"),
      mimeType: "image/png",
    };

    await assert.rejects(
      normalizeImagesForModel(
        [
          {
            role: "toolResult",
            toolCallId: "broken-read",
            toolName: "read",
            content: [{ type: "text", text: "result" }, image],
            isError: false,
            timestamp: 1,
          },
          {
            role: "user",
            content: Array.from({ length: 20 }, () => image),
            timestamp: 2,
          },
        ],
        { api: "anthropic-messages" },
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /message 0, content 1 \(2600x1400\).*image\/png.*2000px/,
        );
        assert.ok(error.cause instanceof Error);
        return true;
      },
    );
  });

  it("leaves non-Anthropic oversized images unchanged", async () => {
    const oversized = await pngImage(190, 8101);
    const messages: Message[] = [
      { role: "user", content: [oversized], timestamp: 1 },
    ];

    const normalized = await normalizeImagesForModel(messages, {
      api: "openai-responses",
    });

    assert.equal(normalized, messages);
  });
});
