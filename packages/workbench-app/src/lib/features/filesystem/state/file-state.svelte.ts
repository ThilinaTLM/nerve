import type { FilesystemFileResponse } from "$lib/api";
import type { MermaidBlockLocator } from "@nervekit/ui-kit/core/components/mermaid-blocks";
import type { FileDisplayMode } from "@nervekit/ui-kit/core/utils/file-display";

export type FileViewState = {
  id: string;
  projectId: string;
  path: string;
  line?: number;
  content?: FilesystemFileResponse;
  displayMode?: FileDisplayMode;
  wrapLines?: boolean;
  loading: boolean;
  error?: string;
};

type MermaidViewStateBase = {
  id: string;
  projectId: string;
  locator: MermaidBlockLocator;
  source?: string;
  loading: boolean;
  error?: string;
};

export type MarkdownMermaidViewState =
  | (MermaidViewStateBase & {
      origin: "file";
      path: string;
      relativePath?: string;
      name?: string;
      truncated?: boolean;
    })
  | (MermaidViewStateBase & {
      origin: "inline";
      sourceKey: string;
      name: string;
      source: string;
    });

export const fileState = $state({
  fileViews: {} as Record<string, FileViewState>,
  mermaidViews: {} as Record<string, MarkdownMermaidViewState>,
  openFileTabIds: [] as string[],
});
