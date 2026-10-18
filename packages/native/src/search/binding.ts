import type { FileCompletionMatch } from "./file-completion-index.js";
import type { SearchResult } from "./contracts.js";

// Only non-derivable components/casing cross N-API. Utf16String preserves lone surrogates.
export interface NativeCompletionCandidate {
  path: string;
  name?: string;
  stem?: string;
  pathLower?: string;
  nameLower?: string;
  stemLower?: string;
  segments?: string[];
  segmentsLower?: string[];
  depth?: number;
  directory: boolean;
  localeRank: number;
}
export interface NativeCompletionQuery {
  aligned?: string;
  value: string;
  lower: string;
  path: string;
  folder: boolean;
  ordered: boolean;
  terms: { value: string; lower: string; aligned?: string }[];
}
export interface NativeSearchField {
  key: string;
  text: string;
  lower?: string;
  nameLower?: string;
  stemLower?: string;
  segmentsLower?: string[];
  aligned?: string;
  caseSpans?: number[][];
}
export interface NativeSearchDocument {
  id: string;
  kind: string;
  fields: NativeSearchField[];
}
export interface NativeFileCompletionIndexHandle {
  build(candidates: NativeCompletionCandidate[]): Promise<number>;
  stage(documents: NativeSearchDocument[], remove: string[]): Promise<number>;
  commit(): Promise<number>;
  discard(): Promise<number>;
  query(
    query: NativeCompletionQuery,
    limit: number,
  ): Promise<FileCompletionMatch[]>;
  search(
    query: NativeCompletionQuery,
    kinds: string[] | undefined,
    limit: number,
    documentIds?: string[],
  ): Promise<SearchResult>;
  close(): Promise<void>;
}
export interface NativeSearchBinding {
  NativeFileCompletionIndex: new () => NativeFileCompletionIndexHandle;
}
