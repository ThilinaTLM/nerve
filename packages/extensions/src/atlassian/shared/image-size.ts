/** Pixel size of an image, read from its header; no decoding. */
export type ImageSize = { width: number; height: number };

const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32be = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** PNG, JPEG and GIF dimensions; undefined for anything else or a damaged header. */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
  // PNG: signature, then the IHDR chunk with width and height.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  // GIF: logical screen size, little endian.
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  // JPEG: the first start-of-frame segment.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return undefined;
      const marker = bytes[at + 1];
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame) {
        const height = u16be(bytes, at + 5);
        const width = u16be(bytes, at + 7);
        return width > 0 && height > 0 ? { width, height } : undefined;
      }
      at += 2 + u16be(bytes, at + 2);
    }
  }
  return undefined;
}
