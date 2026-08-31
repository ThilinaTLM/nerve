import { parentPort, workerData } from "node:worker_threads";
import { NodeHtmlMarkdown } from "node-html-markdown";

interface WorkerInput {
  source: string;
  mode: "html" | "confluence-storage";
  maxOutputBytes: number;
}

type WorkerResult =
  | { ok: true; markdown: string }
  | { ok: false; code: string; message: string };

function prepareConfluenceStorage(value: string): string {
  return value
    .replaceAll(
      /<ac:structured-macro\b[^>]*ac:name=["']code["'][^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gi,
      (_match, code: string) => `<pre><code>${escapeHtml(code)}</code></pre>`,
    )
    .replaceAll(
      /<ac:structured-macro\b[^>]*ac:name=["']([^"']+)["'][^>]*>[\s\S]*?<\/ac:structured-macro>/gi,
      (_match, name: string) =>
        `<blockquote>Confluence macro: ${escapeHtml(name)}</blockquote>`,
    )
    .replaceAll(
      /<ac:image\b[^>]*>[\s\S]*?<ri:attachment\b[^>]*ri:filename=["']([^"']+)["'][^>]*\/?>(?:[\s\S]*?<\/ri:attachment>)?[\s\S]*?<\/ac:image>/gi,
      (_match, filename: string) =>
        `<p>![${escapeAttribute(filename)}](${escapeAttribute(filename)})</p>`,
    )
    .replaceAll(
      /<ri:attachment\b[^>]*ri:filename=["']([^"']+)["'][^>]*\/?>(?:<\/ri:attachment>)?/gi,
      (_match, filename: string) => `<code>${escapeHtml(filename)}</code>`,
    )
    .replaceAll(
      /<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/gi,
      (_match, text: string) => `<pre><code>${escapeHtml(text)}</code></pre>`,
    )
    .replaceAll(
      /<ac:parameter\b[^>]*ac:name=["']title["'][^>]*>([\s\S]*?)<\/ac:parameter>/gi,
      "<strong>$1</strong>",
    );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("]", "\\]")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29");
}

function execute(input: WorkerInput): WorkerResult {
  try {
    const source =
      input.mode === "confluence-storage"
        ? prepareConfluenceStorage(input.source)
        : input.source;
    const converter = new NodeHtmlMarkdown(
      input.mode === "confluence-storage"
        ? {
            bulletMarker: "-",
            codeBlockStyle: "fenced",
            emDelimiter: "*",
            strongDelimiter: "**",
          }
        : undefined,
    );
    const markdown = converter.translate(source).trim();
    if (Buffer.byteLength(markdown, "utf8") > input.maxOutputBytes) {
      return {
        ok: false,
        code: "HTML_CONVERSION_OUTPUT_TOO_LARGE",
        message: "Converted Markdown exceeds the 8 MiB output limit.",
      };
    }
    return { ok: true, markdown };
  } catch (error) {
    return {
      ok: false,
      code: "HTML_CONVERSION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

if (!parentPort) {
  throw new Error("HTML conversion worker requires a parent port.");
}

parentPort.postMessage(execute(workerData as WorkerInput));
