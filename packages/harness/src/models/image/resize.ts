import type { Buffer } from "node:buffer";
import { image } from "@nervekit/native";

const ICON_MAX_BASE64_BYTES = 8_000_000;

export interface ResizedImage {
  buffer: Buffer;
  mimeType: string;
  changed: boolean;
  width: number;
  height: number;
}

/** Fit `source` inside `maxDimension` with the native image pipeline. */
export async function resizeImage(
  source: Buffer,
  _mimeType: string,
  maxDimension: number,
): Promise<ResizedImage> {
  const prepared = await image.prepareImage(source, {
    maxDimension,
    maxBase64Bytes: ICON_MAX_BASE64_BYTES,
    acceptedFormats: ["png", "jpeg", "gif", "webp"],
  });
  return {
    buffer: prepared.data,
    mimeType: prepared.mimeType,
    changed: prepared.changed,
    width: prepared.width,
    height: prepared.height,
  };
}
