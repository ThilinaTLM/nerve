/** Declarations of the `web` runtime namespace. */
export const WEB_DTS_TYPES = `interface WebPage {
  url: string;
  status: number;
  contentType: string;
  title?: string;
  /** Markdown or text; the parsed value for JSON. */
  content: unknown;
}`;
