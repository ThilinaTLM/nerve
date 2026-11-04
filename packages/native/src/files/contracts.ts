export type FileEntryKind = "file" | "directory" | "other";

export interface ListDirectoryOptions {
  /** Include dotfiles. Defaults to true; `.git` is always listed (and marked ignored). */
  includeHidden?: boolean;
}

export interface DirectoryEntry {
  name: string;
  /** Project-relative path using "/" separators. */
  path: string;
  /** Symlinks report the kind of their target when it resolves inside the root. */
  kind: FileEntryKind;
  symlink: boolean;
  /** Matches `.gitignore`/`.ignore`/`.git/info/exclude`/global excludes, or is `.git`. */
  ignored: boolean;
}

export interface PathIndexOptions {
  /** Entry budget; the index is `incomplete` when the walk hits it. Default 200_000. */
  maxEntries?: number;
}

export type PathIndexKind = "file" | "directory";

export interface PathIndexQueryOptions {
  limit?: number;
  kinds?: PathIndexKind[];
}

export interface PathIndexMatch {
  path: string;
  kind: PathIndexKind;
  score: number;
  /** UTF-16 offsets of matched characters inside `path`, ascending. */
  positions: number[];
}

export interface PathIndexResult {
  matches: PathIndexMatch[];
  /** True while the initial walk is running or when the entry budget was hit. */
  incomplete: boolean;
}

export interface PathIndex {
  search(
    query: string,
    options?: PathIndexQueryOptions,
  ): Promise<PathIndexResult>;
  /**
   * An empty query returns entries in path order (up to `limit`), so it can list everything.
   * Project-relative paths (files or directories) that changed. Each is re-stat'ed:
   * missing paths are removed with their subtree, directories are rescanned,
   * files are added unless ignored. Changes to `.gitignore`/`.ignore` rescan their directory.
   */
  applyChanges(changedPaths: string[]): Promise<void>;
  /** Starts a background rebuild and returns at once; searches stay `incomplete` until it ends. */
  rebuild(): Promise<void>;
  close(): void;
}

export interface ContentSearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Gitignore-style globs relative to the root; a file must match one when given. */
  include?: string[];
  /** Gitignore-style globs relative to the root; matching files/directories are skipped. */
  exclude?: string[];
  includeIgnored?: boolean;
  /** Maximum number of matching lines. Default 1000. */
  maxResults?: number;
  /** Maximum preview characters per line. Default 300. */
  maxPreviewChars?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ContentMatch {
  /** 1-based. */
  line: number;
  /** Line text, possibly windowed around the first match when long. */
  text: string;
  /** UTF-16 half-open `[start, end)` offsets into `text`. */
  ranges: Array<[number, number]>;
}

export interface ContentFileMatches {
  path: string;
  matches: ContentMatch[];
}

export interface ContentSearchResult {
  files: ContentFileMatches[];
  truncated: boolean;
  searchedFiles: number;
}
