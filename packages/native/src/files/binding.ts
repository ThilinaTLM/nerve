import type {
  ContentSearchResult,
  DirectoryEntry,
  PathIndexResult,
} from "./contracts.js";

export interface NativePathIndexHandle {
  id: number;
}

export interface NativeContentSearchRequest {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  include?: string[];
  exclude?: string[];
  includeIgnored?: boolean;
  maxResults?: number;
  maxPreviewChars?: number;
  timeoutMs?: number;
  /** Caller-chosen id so `cancelFileContentSearch` can stop the walk cooperatively. */
  cancelId?: number;
}

/** Optional: addons built before the files domain lack these members. */
export interface NativeFilesBinding {
  listProjectDirectory?(
    root: string,
    relativePath: string,
    includeHidden: boolean,
  ): Promise<DirectoryEntry[]>;
  createFilePathIndex?(
    root: string,
    maxEntries: number | undefined,
  ): NativePathIndexHandle;
  searchFilePathIndex?(
    handle: NativePathIndexHandle,
    query: string,
    limit: number,
    kinds: string[] | undefined,
  ): Promise<PathIndexResult>;
  applyFilePathIndexChanges?(
    handle: NativePathIndexHandle,
    paths: string[],
  ): Promise<void>;
  rebuildFilePathIndex?(handle: NativePathIndexHandle): void;
  closeFilePathIndex?(handle: NativePathIndexHandle): void;
  searchFileContent?(
    root: string,
    request: NativeContentSearchRequest,
  ): Promise<ContentSearchResult>;
  cancelFileContentSearch?(cancelId: number): void;
}
