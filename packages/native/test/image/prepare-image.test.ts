// Runs through the compiled addon on every CI/release platform, covering the
// N-API boundary that Rust-only tests cannot.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { image } from "../../src/index.js";

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** Minimal 8-bit RGB PNG; `noisy` makes it incompressible. */
function png(width: number, height: number, noisy = false): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rowBytes = width * 3 + 1;
  const raw = Buffer.alloc(rowBytes * height, noisy ? 0 : 0x60);
  let state = 12345;
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0;
    if (!noisy) continue;
    for (let x = 1; x < rowBytes; x += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      raw[y * rowBytes + x] = state >>> 24;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngSize(data: Buffer): { width: number; height: number } {
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const limits = { maxDimension: 2000, maxBase64Bytes: 5_000_000 };

test("image preparation is available in the loaded addon", () => {
  assert.equal(image.isAvailable(), true);
});

test("returns compliant images unchanged", async () => {
  const source = png(12, 8);
  const out = await image.prepareImage(source, limits);
  assert.equal(out.changed, false);
  assert.equal(out.mimeType, "image/png");
  assert.deepEqual(out.data, source);
  assert.deepEqual({ width: out.width, height: out.height }, pngSize(source));
});

test("fits an oversized PNG inside the dimension limit", async () => {
  const out = await image.prepareImage(png(1280, 2600), limits);
  assert.equal(out.changed, true);
  assert.equal(out.mimeType, "image/png");
  assert.deepEqual(
    { width: out.width, height: out.height },
    { width: 985, height: 2000 },
  );
  assert.deepEqual(pngSize(out.data), { width: 985, height: 2000 });
});

test("falls back to JPEG when the PNG exceeds the byte limit", async () => {
  const out = await image.prepareImage(png(400, 400, true), {
    maxDimension: 2000,
    maxBase64Bytes: 200_000,
  });
  assert.equal(out.changed, true);
  assert.equal(out.mimeType, "image/jpeg");
  assert.equal(out.data[0], 0xff);
  assert.equal(out.data[1], 0xd8);
  assert.ok(Math.ceil(out.data.length / 3) * 4 <= 200_000);
});

test("rejects undecodable input", async () => {
  await assert.rejects(
    image.prepareImage(Buffer.from("not an image"), limits),
    /image/i,
  );
});
