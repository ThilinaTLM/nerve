import type {
  ImageInfo,
  PreparedImage,
  TransformedImage,
  TransformImageOps,
} from "./contracts.js";

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
  transformImageNative?(
    data: Buffer,
    ops: TransformImageOps,
  ): Promise<TransformedImage>;
  imageInfoNative?(data: Buffer): Promise<ImageInfo>;
}
