import { binding } from "../binding/loader.js";
import type { NativeImageBinding } from "./binding.js";
import type {
  ImageInfo,
  PrepareImageOptions,
  PreparedImage,
  TransformedImage,
  TransformImageOps,
} from "./contracts.js";

export type * from "./contracts.js";

const native = binding as typeof binding & NativeImageBinding;

/** True when the loaded addon includes the image domain. */
export function isAvailable(): boolean {
  return typeof native.prepareModelImage === "function";
}

/**
 * Decodes the first frame, fits it inside `maxDimension`, and re-encodes it
 * under `maxBase64Bytes` when needed. Runs off the Node thread; rejects with
 * the decoder or limit error.
 */
export async function prepareImage(
  data: Buffer,
  options: PrepareImageOptions,
): Promise<PreparedImage> {
  if (typeof native.prepareModelImage !== "function") {
    throw new Error("Native image support is not available");
  }
  return await native.prepareModelImage(data, {
    maxDimension: options.maxDimension,
    maxBase64Bytes: options.maxBase64Bytes,
    acceptedFormats: [...(options.acceptedFormats ?? ["png", "jpeg", "webp"])],
    outputFormats: [...(options.outputFormats ?? ["png", "jpeg"])],
  });
}

/**
 * Crops, then resizes, then encodes. Runs off the Node thread; rejects on
 * invalid operations, unsupported input, or inputs over 50 MB / 40 megapixels.
 */
export async function transformImage(
  data: Buffer,
  ops: TransformImageOps,
): Promise<TransformedImage> {
  if (typeof native.transformImageNative !== "function") {
    throw new Error("Native image support is not available");
  }
  return await native.transformImageNative(data, ops);
}

/** Reads format and dimensions from the header without decoding pixels. */
export async function imageInfo(data: Buffer): Promise<ImageInfo> {
  if (typeof native.imageInfoNative !== "function") {
    throw new Error("Native image support is not available");
  }
  return await native.imageInfoNative(data);
}
