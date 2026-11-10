/** Pure-TS image type sniffing and header-only size reading (PNG, JPEG, GIF, WebP). */

export type ImageKind = "png" | "jpeg" | "gif" | "webp" | "svg";

export function detectImageKind(bytes: Uint8Array): ImageKind | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "jpeg";
  if (bytes.length >= 6 && ascii(bytes, 0, 3) === "GIF") return "gif";
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  )
    return "webp";
  const head = Buffer.from(bytes.subarray(0, 1024))
    .toString("utf8")
    .trimStart();
  if (/^(<\?xml[\s\S]*?)?<svg[\s>]/i.test(head)) return "svg";
  return undefined;
}

export function readImageSize(
  bytes: Uint8Array,
  kind: ImageKind | undefined = detectImageKind(bytes),
): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (kind === "png") {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (kind === "gif") {
      return {
        width: view.getUint16(6, true),
        height: view.getUint16(8, true),
      };
    }
    if (kind === "jpeg") return jpegSize(bytes, view);
    if (kind === "webp") return webpSize(bytes, view);
  } catch {
    return undefined;
  }
  return undefined;
}

function jpegSize(bytes: Uint8Array, view: DataView) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset++;
      continue;
    }
    // Standalone markers have no length.
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return undefined;
}

function webpSize(bytes: Uint8Array, view: DataView) {
  const chunk = ascii(bytes, 12, 16);
  if (chunk === "VP8X") {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  return undefined;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
