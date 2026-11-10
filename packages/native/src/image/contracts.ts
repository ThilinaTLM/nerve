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
