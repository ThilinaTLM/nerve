// GENERATED from the method tables (sdk-dts.test.ts); regenerate with UPDATE_SDK_DTS=1.
// web.d.ts: sandbox globals and the shapes they return.

// FileHandle is declared in files.d.ts.
interface WebPage {
  url: string;
  status: number;
  contentType: string;
  title?: string;
  /** Markdown or text; the parsed value for JSON. */
  content: unknown;
}
interface WebHit {
  title: string;
  url: string;
  snippet: string;
  published?: string;
}

declare const web: {
  /** GET a URL. Default: HTML as markdown, text as text, JSON parsed; binary or `as: "file"` saves an artifact. */
  fetch(url: string | { url: string; as?: "markdown" | "text" | "json" | "file"; name?: string }): Promise<WebPage | FileHandle>;
  /** Web search; default 5 results (max 20). */
  search(query: string | { query: string; limit?: number }): Promise<WebHit[]>;
};
