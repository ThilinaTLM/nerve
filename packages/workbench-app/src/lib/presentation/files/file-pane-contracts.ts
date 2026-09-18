import type { FileDisplayMode } from "@nervekit/ui-kit/display/file-display";

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
  editable?: boolean;
};

export type FilePaneViewModel = {
  path: string;
  line?: number;
  content?: FilePaneContent;
  draft?: string;
  dirty?: boolean;
  saving?: boolean;
  saveError?: string;
  displayMode?: FileDisplayMode;
  wrapLines?: boolean;
  loading: boolean;
  error?: string;
};
