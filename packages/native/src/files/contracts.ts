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

export interface GrepOptions {
  pattern: string;
  /** Fixed string instead of a regular expression. */
  literal?: boolean;
  /** Default false (case-sensitive). */
  ignoreCase?: boolean;
  /** ripgrep `--glob` semantics: a glob without `/` matches the file name at any depth. */
  glob?: string;
  /** Lines of context before and after each match. Default 0. */
  context?: number;
  /** Match lines to return; the totals still count every match. */
  limit: number;
  /** Longest returned line text in bytes, cut at a character boundary. Default: whole line. */
  maxLineBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GrepLine {
  /** Relative to the display root, "/" separators. */
  path: string;
  /** 1-based. */
  line: number;
  text: string;
  /** False for context lines. */
  isMatch: boolean;
}

export interface GrepResult {
  /** Ordered by path then line; at most `limit` matches plus context. */
  lines: GrepLine[];
  /** Matching lines across all searched files, beyond `limit` too. */
  totalMatches: number;
  totalFiles: number;
}

export interface FindFilesOptions {
  /**
   * Glob. A pattern containing `/` matches the full path (a relative one is anchored
   * with a leading `**\/`); any other pattern matches the file name.
   */
  pattern: string;
  limit: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface FindFilesResult {
  /** The first `limit` regular files by path, relative to the root. */
  paths: string[];
  /** All matching files, beyond `limit` too. */
  total: number;
}
