import { Buffer } from "node:buffer";
import { crc32, deflateSync } from "node:zlib";
import type { ImageContent } from "@earendil-works/pi-ai";

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** Minimal 8-bit RGB PNG; `noisy` makes it incompressible. */
export function pngBuffer(
  width: number,
  height: number,
  noisy = false,
): Buffer {
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

export function pngImage(
  width: number,
  height: number,
  noisy = false,
): ImageContent {
  return {
    type: "image",
    data: pngBuffer(width, height, noisy).toString("base64"),
    mimeType: "image/png",
  };
}

/** Read width/height from a PNG header, asserting the signature. */
export function pngSize(data: Buffer): { width: number; height: number } {
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** 1x1 GIF89a. */
export const TINY_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
