import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { executeGenerateImage } from "../../src/execution/image-generation/generate-image.js";
import { createTempProject } from "../support/project-fixtures.js";

void test("generated image details report the persisted byte count", async () => {
  const project = await createTempProject();
  const data = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
  const result = await executeGenerateImage(
    { prompt: "A dot" },
    {
      artifactDir: project.root,
      generateImage: async () => ({
        provider: "test",
        model: "test",
        images: [{ data }],
      }),
    },
  );
  const images = result.details?.images as Array<{
    path: string;
    bytes: number;
    width?: number;
    height?: number;
  }>;
  assert.equal(images[0]!.bytes, data.byteLength);
  assert.equal(images[0]!.width, 1);
  assert.equal(images[0]!.height, 1);
  assert.equal((await readFile(images[0]!.path)).byteLength, images[0]!.bytes);
  assert.equal(result.content, "Generated 1 image with test.");
});

void test("generated JPEG and WebP dimensions are read from bounded headers", async () => {
  const project = await createTempProject();
  const webp = (kind: string, payload: Buffer) => {
    const data = Buffer.alloc(20 + payload.length + (payload.length % 2));
    data.write("RIFF", 0);
    data.writeUInt32LE(data.length - 8, 4);
    data.write("WEBP", 8);
    data.write(kind, 12);
    data.writeUInt32LE(payload.length, 16);
    payload.copy(data, 20);
    return data;
  };
  const extended = Buffer.alloc(10);
  extended.writeUIntLE(31, 4, 3);
  extended.writeUIntLE(15, 7, 3);
  const lossless = Buffer.alloc(5);
  lossless[0] = 0x2f;
  lossless.writeUInt32LE(31 | (15 << 14), 1);
  const lossy = Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, 32, 0, 16, 0]);
  // Header-only fixtures exercise metadata extraction, not image decoding.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 16, 0, 32]);
  const imageData = [
    jpeg,
    webp("VP8X", extended),
    webp("VP8L", lossless),
    webp("VP8 ", lossy),
    jpeg.subarray(0, 5),
  ];
  const result = await executeGenerateImage(
    { prompt: "rectangles" },
    {
      artifactDir: project.root,
      generateImage: async () => ({
        provider: "test",
        model: "test",
        images: imageData.map((data) => ({ data })),
      }),
    },
  );
  const images = result.details?.images as Array<{
    width?: number;
    height?: number;
    bytes: number;
  }>;
  for (const image of images.slice(0, 4)) {
    assert.equal(image.width, 32);
    assert.equal(image.height, 16);
  }
  assert.equal(images[4]!.width, undefined);
  assert.equal(images[4]!.height, undefined);
  assert.deepEqual(
    images.map((image) => image.bytes),
    imageData.map((data) => data.byteLength),
  );
});
