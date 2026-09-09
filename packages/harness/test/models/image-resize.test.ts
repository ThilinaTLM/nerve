import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import sharp from "sharp";
import { resizeImageWithSharp } from "../../src/models/image/resize.js";

async function png(width: number, height: number): Promise<Buffer> {
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 32, g: 96, b: 160 },
    },
  })
    .png()
    .toBuffer();
}

describe("image resize", () => {
  it("returns trustworthy dimensions for unchanged images", async () => {
    const source = await png(320, 180);

    const result = await resizeImageWithSharp(source, "image/png", 2_000);

    assert.equal(result.changed, false);
    assert.equal(result.buffer, source);
    assert.equal(result.mimeType, "image/png");
    assert.deepEqual(
      { width: result.width, height: result.height },
      { width: 320, height: 180 },
    );
  });

  it("resizes inside the limit while preserving aspect ratio", async () => {
    const source = await png(1_400, 2_600);

    const result = await resizeImageWithSharp(source, "image/png", 2_000);

    assert.equal(result.changed, true);
    assert.equal(result.mimeType, "image/png");
    assert.deepEqual(
      { width: result.width, height: result.height },
      { width: 1_077, height: 2_000 },
    );
    const metadata = await sharp(result.buffer).metadata();
    assert.equal(metadata.width, result.width);
    assert.equal(metadata.height, result.height);
  });

  it("rejects undecodable image data", async () => {
    await assert.rejects(
      resizeImageWithSharp(Buffer.from("not an image"), "image/png", 2_000),
      /unsupported image format|Input buffer/i,
    );
  });
});
