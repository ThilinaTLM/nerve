import type { FilesystemFileResponse } from "$lib/api";
import type { FileDisplayMode } from "$lib/core/utils/file-display";

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

export const fileState = $state({
  fileViews: {} as Record<string, FileViewState>,
  openFileTabIds: [] as string[],
});
