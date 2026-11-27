/**
 * Declarations of the `files`, `artifacts` and `image` runtime namespaces (shared by every extension: `FileHandle`).
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

interface FileMatch {
  /** Relative to the cwd. */
  path: string;
  line: number;
  text: string;
}

/** One edit. Without \`all\` it must match exactly once; with it at least once, or exactly \`count\` times. */
type TextEdit =
  | { oldText: string; newText: string; all?: boolean; count?: number }
  /** \`$1\` and \`$<name>\` work in replacement, as in String.replace. */
  | { pattern: RegExp | string; replacement: string; flags?: string; all?: boolean; count?: number }
  /** Replaces from \`from\` through the next \`through\` (replaced too). */
  | { from: string; through: string; newText: string }
  /** Replaces from \`from\` up to the next \`upTo\` (kept). */
  | { from: string; upTo: string; newText: string }
  | { insertBefore: string; text: string }
  | { insertAfter: string; text: string };

interface EditResult {
  /** The files an edit matched; \`edits\` lists each edit's matches there. */
  files: { path: string; changed: boolean; edits: { index: number; matches: number }[] }[];
  /** Unified diff of the changed files; capped, then \`diffFile\` holds all of it. */
  diff: string;
  diffFile?: FileHandle;
  dryRun?: true;
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
