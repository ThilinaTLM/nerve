import type { SearchResult } from "./contracts.js";

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
export interface NativeSearchIndexHandle {
  stage(documents: NativeSearchDocument[], remove: string[]): Promise<number>;
  commit(): Promise<number>;
  discard(): Promise<number>;
  search(
    query: NativeCompletionQuery,
    kinds: string[] | undefined,
    limit: number,
    documentIds?: string[],
  ): Promise<SearchResult>;
  close(): Promise<void>;
}
export interface NativeSearchBinding {
  NativeSearchIndex: new () => NativeSearchIndexHandle;
}
