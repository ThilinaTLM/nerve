// GENERATED from the method tables (sdk-dts.test.ts); regenerate with UPDATE_SDK_DTS=1.
// files.d.ts: sandbox globals and the shapes they return.

/** "artifact:<name>" (a file of this conversation) or a workspace path. */
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
}

declare const files: {
  list(): Promise<ArtifactInfo[]>;
  /** Default "text"; max 20 MB. */
  read(handle: FileHandle, options: { as: "bytes" }): Promise<Uint8Array>;
  read(handle: FileHandle, options?: { as?: "text" }): Promise<string>;
  /** `name` or an `artifact:name` handle writes an artifact; with workspace: true `name` is a workspace path. Returns the handle or path. */
  write(name: string, data: string | Uint8Array | ArrayBuffer, options?: { workspace?: boolean }): Promise<string>;
  /** Like the edit tool: each oldText must match exactly once in the original; all edits apply atomically. Returns the handle. */
  edit(handle: FileHandle, edits: { oldText: string; newText: string }[]): Promise<FileHandle>;
};

declare const diagram: {
  /** Kroki engine such as mermaid, d2 or plantuml; returns a PNG artifact handle. */
  render(options: { type: string; source: string; name?: string }): Promise<FileHandle>;
};

/** Chain over the native image module; the bytes never enter the script. */
interface ImageChain {
  /** fit "inside" (default) never enlarges. */
  resize(options: { width?: number; height?: number; fit?: "inside" | "cover" | "fill" }): ImageChain;
  /** Runs before resize. */
  crop(options: { left: number; top: number; width: number; height: number }): ImageChain;
  png(): ImageChain;
  jpeg(options?: { quality?: number }): ImageChain;
  info(): Promise<ImageInfo>;
  save(name: string): Promise<FileHandle>;
}
declare function image(handle: FileHandle): ImageChain;
