export type ImageFormat = "png" | "jpeg" | "gif" | "webp";
export type ImageOutputFormat = "png" | "jpeg";

export interface PrepareImageOptions {
  /** Longest allowed side in pixels; larger images are fitted inside, never enlarged. */
  maxDimension: number;
  /** Maximum base64-encoded size of the result. */
  maxBase64Bytes: number;
  /** Formats that may be returned unchanged when within limits. Defaults to png, jpeg, webp. */
  acceptedFormats?: readonly ImageFormat[];
  /** Formats used when re-encoding, in preference order. Defaults to png, jpeg. */
  outputFormats?: readonly ImageOutputFormat[];
}

export interface PreparedImage {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  /** False when the source bytes were returned as they were. */
  changed: boolean;
}

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
}

export interface TransformImageOps {
  /** Applied first. Must lie inside the image. */
  crop?: { left: number; top: number; width: number; height: number };
  /**
   * Applied after crop. With one dimension the aspect ratio is kept. `fit`
   * (default "inside") fits within the box without enlarging; "cover" fills
   * the box and trims the overflow; "fill" stretches to the exact box.
   */
  resize?: {
    width?: number;
    height?: number;
    fit?: "inside" | "cover" | "fill";
  };
  /** Defaults to the input format when png/jpeg, else png. */
  format?: ImageOutputFormat;
  /** 1-100, JPEG only. Defaults to 85. */
  quality?: number;
}

export interface TransformedImage {
  data: Buffer;
  format: ImageOutputFormat;
  width: number;
  height: number;
}
