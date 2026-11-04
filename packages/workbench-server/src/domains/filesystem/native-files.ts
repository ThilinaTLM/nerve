/**
 * Loader for the optional native `files` API (`@nervekit/native`). Typed locally
 * so the server keeps working (with Node fallbacks) when the addon is missing
 * or predates the API.
 */
export type NativeListedEntry = {
  name: string;
  path: string;
  kind: "file" | "directory" | "other";
  symlink: boolean;
  ignored: boolean;
};

export type NativePathMatch = {
  path: string;
  kind: "file" | "directory";
  score: number;
  positions: number[];
};

export interface NativePathIndex {
  search(
    query: string,
    options?: { limit?: number; kinds?: Array<"file" | "directory"> },
  ): Promise<{ matches: NativePathMatch[]; incomplete: boolean }>;
  applyChanges(changedPaths: string[]): Promise<void>;
  rebuild(): Promise<void>;
  close(): void;
}

export type NativeContentSearchOptions = {
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
};

export interface NativeFilesApi {
  listDirectory(
    root: string,
    relativePath: string,
    options?: { includeHidden?: boolean },
  ): Promise<NativeListedEntry[]>;
  createPathIndex(
    root: string,
    options?: { maxEntries?: number },
  ): NativePathIndex;
  searchContent(
    root: string,
    options: NativeContentSearchOptions,
  ): Promise<{
    files: Array<{
      path: string;
      matches: Array<{
        line: number;
        text: string;
        ranges: Array<[number, number]>;
      }>;
    }>;
    truncated: boolean;
    searchedFiles: number;
  }>;
}

let loaded: Promise<NativeFilesApi | undefined> | undefined;

function isFilesApi(value: unknown): value is NativeFilesApi {
  const api = value as
    | (Partial<NativeFilesApi> & { isAvailable?: () => boolean })
    | undefined;
  // The wrapper namespace exists even when the addon binary predates the API.
  if (typeof api?.isAvailable === "function" && !api.isAvailable())
    return false;
  return (
    typeof api?.listDirectory === "function" &&
    typeof api.createPathIndex === "function" &&
    typeof api.searchContent === "function"
  );
}

export function loadNativeFiles(): Promise<NativeFilesApi | undefined> {
  loaded ??= import("@nervekit/native")
    .then((module) => {
      const files = (module as unknown as { files?: unknown }).files;
      return isFilesApi(files) ? files : undefined;
    })
    .catch(() => undefined);
  return loaded;
}

/** Test seam: pass `null` to restore lazy loading. */
export function setNativeFilesForTesting(
  api: NativeFilesApi | undefined | null,
): void {
  loaded = api === null ? undefined : Promise.resolve(api);
}
