/** Provider-owned opaque identity/kind; authorization and metadata remain outside native. */
export interface SearchDocument {
  id: string;
  kind: string;
  fields: SearchField[];
}
export interface SearchField {
  key: "path" | "name" | "title" | "identifier" | "description";
  text: string;
}
export interface SearchUpdate {
  upsert: SearchDocument[];
  remove: string[];
}
export interface SearchQuery {
  text: string;
  kinds?: string[];
  /** Optional filter of at most 256 opaque IDs; missing IDs are ignored, [] matches none. */
  documentIds?: string[];
  /** Candidate pool, not the UI display cap. Default 64; maximum 256. */
  limit?: number;
}
export interface SearchFieldMatch {
  fieldIndex: number;
  /** Zero-based UTF-16 half-open offsets within this field's original text. */
  ranges: [number, number][];
  score: number;
}
export interface SearchItem {
  id: string;
  lexicalScore: number;
  matches: SearchFieldMatch[];
}
export interface SearchResult {
  revision: number;
  items: SearchItem[];
}
export interface SearchIndex {
  /** Atomic full-document replacement. Missing-only removals leave revision unchanged. */
  update(input: SearchUpdate): Promise<{ revision: number }>;
  query(input: SearchQuery): Promise<SearchResult>;
  close(): Promise<void>;
}
