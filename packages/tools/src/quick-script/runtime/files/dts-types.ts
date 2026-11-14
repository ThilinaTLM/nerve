/**
 * Declarations of the `files` and `image` runtime namespaces (shared by every extension: `FileHandle`).
 */
export const FILES_DTS_TYPES = `/** "artifact:<name>" (a file of this conversation) or a workspace path. */
type FileHandle = string;

interface ArtifactInfo {
  handle: FileHandle;
  name: string;
  bytes: number;
  mediaType: string;
  modified: string;
}

interface ImageInfo {
  format: "png" | "jpeg";
  width: number;
  height: number;
  bytes: number;
}`;

/** Chain steps that only build the pending operations; `info` and `save` come from the method table. */
export const IMAGE_CHAIN_OPS = `  /** fit "inside" (default) never enlarges. */
  resize(options: { width?: number; height?: number; fit?: "inside" | "cover" | "fill" }): ImageChain;
  /** Runs before resize. */
  crop(options: { left: number; top: number; width: number; height: number }): ImageChain;
  png(): ImageChain;
  jpeg(options?: { quality?: number }): ImageChain;`;
