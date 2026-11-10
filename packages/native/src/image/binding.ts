import type { PreparedImage } from "./contracts.js";

export interface NativePrepareImageOptions {
  maxDimension: number;
  maxBase64Bytes: number;
  acceptedFormats: string[];
  outputFormats: string[];
}

/** Optional: addons built before the image domain lack this member. */
export interface NativeImageBinding {
  prepareModelImage?(
    data: Buffer,
    options: NativePrepareImageOptions,
  ): Promise<PreparedImage>;
}
