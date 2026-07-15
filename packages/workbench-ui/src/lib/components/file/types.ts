import type { FileDisplayMode } from "@nervekit/ui-kit/core/utils/file-display";

export type FilePaneContent = {
  path: string;
  relativePath?: string;
  name: string;
  size: number;
  type: "text" | "image" | "binary";
  text?: string;
  dataBase64?: string;
  mimeType?: string;
  lineStart?: number;
  targetLine?: number;
  truncated?: boolean;
};

export type FilePaneViewModel = {
  path: string;
  line?: number;
  content?: FilePaneContent;
  displayMode?: FileDisplayMode;
  wrapLines?: boolean;
  loading: boolean;
  error?: string;
};
