import { NodeHtmlMarkdown } from "node-html-markdown";

const converter = new NodeHtmlMarkdown({
  bulletMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});

export function storageXmlToMarkdown(storageXml: string): string {
  const prepared = prepareConfluenceStorage(storageXml);
  return converter.translate(prepared).trim();
}

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
