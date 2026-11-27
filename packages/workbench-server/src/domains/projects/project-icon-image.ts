import { extname } from "node:path";

const MAX_SVG_BYTES = 1024 * 1024;
const MAX_RASTER_BYTES = 12 * 1024 * 1024;

const MIME_BY_EXTENSION = new Map<string, string>([
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
]);

export function iconMimeType(path: string): string | undefined {
  return MIME_BY_EXTENSION.get(extname(path).toLowerCase());
}

/** Upper bound for reading a candidate; rasters are normalized before serving. */
export function maxIconBytes(path: string): number {
  return extname(path).toLowerCase() === ".svg"
    ? MAX_SVG_BYTES
    : MAX_RASTER_BYTES;
}

export function isPlausibleImage(buffer: Buffer, path: string): boolean {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case ".jpg":
    case ".jpeg":
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
    case ".webp":
      return (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      );
    case ".ico":
      return (
        buffer.length >= 6 &&
        buffer[0] === 0 &&
        buffer[1] === 0 &&
        buffer[2] === 1 &&
        buffer[3] === 0
      );
    case ".svg": {
      const source = buffer.subarray(0, 64 * 1024).toString("utf8");
      return (
        /<svg(?:\s|>)/i.test(source) &&
        !/<(?:script|foreignObject)(?:\s|>)/i.test(source) &&
        !/\son[a-z]+\s*=/i.test(source) &&
        !/(?:href|src)\s*=\s*["'](?:https?:)?\/\//i.test(source)
      );
    }
    default:
      return false;
  }
}

/** Best-effort intrinsic size from the file header; undefined when unknown. */
export function imageDimensions(
  buffer: Buffer,
  path: string,
): { width: number; height: number } | undefined {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return buffer.length >= 24
        ? { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
        : undefined;
    case ".webp":
      // Only the extended (VP8X) header stores the canvas size simply.
      return buffer.length >= 30 && buffer.toString("ascii", 12, 16) === "VP8X"
        ? {
            width: buffer.readUIntLE(24, 3) + 1,
            height: buffer.readUIntLE(27, 3) + 1,
          }
        : undefined;
    case ".ico": {
      const count = buffer.length >= 6 ? buffer.readUInt16LE(4) : 0;
      let largest: { width: number; height: number } | undefined;
      for (let index = 0; index < count; index += 1) {
        const offset = 6 + index * 16;
        if (offset + 2 > buffer.length) break;
        const width = buffer[offset] || 256;
        const height = buffer[offset + 1] || 256;
        if (!largest || width > largest.width) largest = { width, height };
      }
      return largest;
    }
    case ".svg":
      return svgDimensions(buffer.subarray(0, 64 * 1024).toString("utf8"));
    default:
      return undefined;
  }
}

function svgDimensions(
  source: string,
): { width: number; height: number } | undefined {
  const tag = /<svg\b[^>]*>/i.exec(source)?.[0];
  if (!tag) return undefined;
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
  const parts = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts?.length === 4 && parts[2] > 0 && parts[3] > 0) {
    return { width: parts[2], height: parts[3] };
  }
  const width = Number.parseFloat(
    /\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(tag)?.[1] ?? "",
  );
  const height = Number.parseFloat(
    /\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(tag)?.[1] ?? "",
  );
  return width > 0 && height > 0 ? { width, height } : undefined;
}
