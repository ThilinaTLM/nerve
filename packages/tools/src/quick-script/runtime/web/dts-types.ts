/** Declarations of the `web` runtime namespace. */
export const WEB_DTS_TYPES = `interface WebPage {
  url: string;
  /** HTTP status; check it, error statuses do not throw. */
  status: number;
  contentType: string;
  title?: string;
  /** Markdown or text; the parsed value for JSON. */
  content: unknown;
}`;
