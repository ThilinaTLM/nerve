/**
 * Declarations of the shapes returned by the `web` namespace.
 */
export const WEB_DTS_TYPES = `
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
}`;
