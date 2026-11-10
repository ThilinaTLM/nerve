import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { ImageContent, Message } from "@earendil-works/pi-ai";
import { normalizeImagesForModel } from "../../src/models/image/normalization.js";
import { imagePolicyForModel } from "../../src/models/image/policy.js";
import { pngImage, pngSize, TINY_GIF } from "./image-fixtures.js";

const anthropic = { api: "anthropic-messages", id: "claude-sonnet" };

function imageBlocks(message: Message): ImageContent[] {
  if (message.role === "assistant" || typeof message.content === "string") {
    return [];
  }
  return message.content.filter(
    (block): block is ImageContent => block.type === "image",
  );
}

describe("image normalization", () => {
  beforeEach(() => {
    mock.method(console, "error", () => undefined);
  });
  afterEach(() => mock.restoreAll());

  it("fits a 1280x2600 PNG to 2000px when the request has over 20 images", async () => {
    const tall = pngImage(1280, 2600);
    const small = pngImage(12, 8);
    const messages: Message[] = [
      {
        role: "toolResult",
        toolCallId: "read",
        toolName: "read",
        content: [{ type: "text", text: "Read image" }, tall],
        isError: false,
        timestamp: 1,
      },
      {
        role: "user",
        content: Array.from({ length: 20 }, () => small),
        timestamp: 2,
      },
    ];

    const normalized = await normalizeImagesForModel(messages, anthropic);

    assert.notEqual(normalized, messages);
    assert.equal(normalized[1], messages[1]);
    assert.equal(imageBlocks(messages[0])[0]?.data, tall.data);
    const out = imageBlocks(normalized[0])[0];
    assert.ok(out);
    assert.equal(out.mimeType, "image/png");
    assert.deepEqual(pngSize(Buffer.from(out.data, "base64")), {
      width: 985,
      height: 2000,
    });
  });

  it("relabels an image whose declared MIME type does not match its bytes", async () => {
    const png = pngImage(12, 8);
    const mislabeled: ImageContent = { ...png, mimeType: "image/jpeg" };
    const messages: Message[] = [
      { role: "user", content: [mislabeled], timestamp: 1 },
    ];

    const normalized = await normalizeImagesForModel(messages, anthropic);

    const out = imageBlocks(normalized[0])[0];
    assert.equal(out?.mimeType, "image/png");
    assert.equal(out?.data, png.data);
  });

  it("leaves compliant images unchanged and returns the same array", async () => {
    const messages: Message[] = [
      { role: "user", content: [pngImage(2600, 1800)], timestamp: 1 },
    ];
    assert.equal(await normalizeImagesForModel(messages, anthropic), messages);
  });

  it("re-encodes oversized-bytes images as JPEG or shrinks them", async () => {
    const noisy = pngImage(1200, 1200, true);
    assert.ok(noisy.data.length > 4_000_000);
    const messages: Message[] = [
      { role: "user", content: [noisy], timestamp: 1 },
    ];

    const normalized = await normalizeImagesForModel(messages, {
      api: "openai-completions",
      id: "some-model",
    });

    const out = imageBlocks(normalized[0])[0];
    assert.ok(out);
    assert.equal(out.mimeType, "image/jpeg");
    assert.ok(out.data.length <= 4_000_000);
  });

  it("replaces an undecodable image with a text placeholder", async () => {
    const broken: ImageContent = {
      type: "image",
      data: Buffer.from("not an image at all").toString("base64"),
      mimeType: "image/png",
    };
    const messages: Message[] = [
      { role: "user", content: [broken], timestamp: 1 },
    ];

    const normalized = await normalizeImagesForModel(messages, anthropic);

    const content = (normalized[0] as { content: unknown[] }).content;
    assert.equal(content.length, 1);
    assert.deepEqual(Object.keys(content[0] as object).sort(), [
      "text",
      "type",
    ]);
    assert.match(
      (content[0] as { text: string }).text,
      /^\[Image omitted: could not be prepared for this model \(image\/png\): .+\]$/,
    );
  });

  it("converts a gif to png for google", async () => {
    const gif: ImageContent = {
      type: "image",
      data: TINY_GIF.toString("base64"),
      mimeType: "image/gif",
    };
    const normalized = await normalizeImagesForModel(
      [{ role: "user", content: [gif], timestamp: 1 }],
      { api: "google-generative-ai", id: "gemini" },
    );
    const out = imageBlocks(normalized[0])[0];
    assert.equal(out?.mimeType, "image/png");
    assert.deepEqual(pngSize(Buffer.from(out.data, "base64")), {
      width: 1,
      height: 1,
    });
  });

  it("keeps a gif for anthropic", async () => {
    const gif: ImageContent = {
      type: "image",
      data: TINY_GIF.toString("base64"),
      mimeType: "image/gif",
    };
    const messages: Message[] = [
      { role: "user", content: [gif], timestamp: 1 },
    ];
    assert.equal(await normalizeImagesForModel(messages, anthropic), messages);
  });
});

describe("image policy", () => {
  it("selects limits per provider family", () => {
    assert.equal(imagePolicyForModel(anthropic, 1).maxDimension, 8000);
    assert.equal(imagePolicyForModel(anthropic, 21).maxDimension, 2000);
    assert.equal(
      imagePolicyForModel(
        { api: "openai-completions", id: "anthropic/claude-4" },
        1,
      ).maxDimension,
      8000,
    );
    assert.equal(
      imagePolicyForModel({ api: "bedrock-converse-stream", id: "nova" }, 1)
        .maxDimension,
      8000,
    );
    assert.equal(
      imagePolicyForModel({ api: "openai-responses", id: "gpt" }, 1)
        .maxDimension,
      2048,
    );
    assert.deepEqual(
      imagePolicyForModel({ api: "mystery" }, 1).acceptedFormats,
      ["png", "jpeg", "webp"],
    );
  });
});
