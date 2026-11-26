import type {
  ContentSearchResult,
  FindFilesResult,
  GrepResult,
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

export interface NativeGrepRequest {
  pattern: string;
  literal?: boolean;
  ignoreCase?: boolean;
  glob?: string;
  context?: number;
  limit: number;
  maxLineBytes?: number;
  timeoutMs?: number;
  cancelId?: number;
}

export interface NativeFindRequest {
  pattern: string;
  limit: number;
  timeoutMs?: number;
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
  grepFiles?(
    displayRoot: string,
    roots: string[],
    request: NativeGrepRequest,
  ): Promise<GrepResult>;
  findProjectFiles?(
    root: string,
    request: NativeFindRequest,
  ): Promise<FindFilesResult>;
}
