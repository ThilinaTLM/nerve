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

const MACRO_TOKEN =
  /<!\[CDATA\[[\s\S]*?\]\]>|<ac:structured-macro\b((?:"[^"]*"|'[^']*'|[^>"'])*)>|<\/ac:structured-macro\s*>/gi;

const PANEL_LABELS: Record<string, string> = {
  info: "Info",
  note: "Note",
  tip: "Tip",
  warning: "Warning",
  success: "Success",
  error: "Error",
  panel: "Panel",
};
const DECORATIVE_MACROS = new Set(["toc", "children", "anchor", "pagetree"]);

/** Replaces `ac:structured-macro` elements (including nested ones) with plain HTML. */
function convertMacros(value: string): string {
  let out = "";
  let cursor = 0;
  let depth = 0;
  let start = -1;
  let attrs = "";
  let bodyStart = 0;
  for (const token of value.matchAll(MACRO_TOKEN)) {
    const text = token[0];
    const index = token.index;
    if (text.startsWith("<![CDATA[")) continue;
    if (text.startsWith("</")) {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0) {
        out += renderMacro(attrs, value.slice(bodyStart, index));
        cursor = index + text.length;
      }
      continue;
    }
    const selfClosing = token[1]?.trimEnd().endsWith("/") === true;
    if (depth === 0) {
      out += value.slice(cursor, index);
      cursor = index;
      if (selfClosing) {
        out += renderMacro(token[1] ?? "", "");
        cursor = index + text.length;
        continue;
      }
      start = index;
      attrs = token[1] ?? "";
      bodyStart = index + text.length;
      depth = 1;
    } else if (!selfClosing) {
      depth += 1;
    }
  }
  // Unterminated macro: keep the remaining source rather than dropping it.
  return out + value.slice(depth > 0 && start >= 0 ? start : cursor);
}

function renderMacro(attrs: string, rawInner: string): string {
  const name = /ac:name\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  const macroName = (name?.[1] ?? name?.[2] ?? "").trim().toLowerCase();
  // Inner macros first, so the remaining ac: markup belongs to this macro only.
  const inner = convertMacros(rawInner);
  const params = new Map<string, string>();
  for (const match of inner.matchAll(
    /<ac:parameter\b[^>]*?ac:name\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/ac:parameter>/gi,
  )) {
    const key = (match[1] ?? match[2] ?? "").toLowerCase();
    if (!params.has(key)) params.set(key, textOf(match[3] ?? ""));
  }
  const rich = /<ac:rich-text-body\b[^>]*>([\s\S]*)<\/ac:rich-text-body>/i.exec(
    inner,
  )?.[1];
  const plain =
    /<ac:plain-text-body\b[^>]*>([\s\S]*?)<\/ac:plain-text-body>/i.exec(
      inner,
    )?.[1];
  const plainText = plain === undefined ? undefined : unwrapCdata(plain);
  const title = params.get("title")?.trim();

  if (macroName === "code") {
    const language = params.get("language")?.trim();
    const cls =
      language && /^[\w+#.-]+$/.test(language)
        ? ` class="language-${language}"`
        : "";
    return `<pre><code${cls}>${escapeHtml(plainText ?? "")}</code></pre>`;
  }
  if (macroName === "status") {
    const label =
      title || params.get("colour") || params.get("color") || "status";
    return `<span>[${escapeHtml(label)}]</span>`;
  }
  if (macroName in PANEL_LABELS) {
    const label = PANEL_LABELS[macroName];
    const heading = title ? `${label}: ${title}` : `${label}:`;
    return `<blockquote><p><strong>${escapeHtml(heading)}</strong></p>${rich ?? ""}</blockquote>`;
  }
  if (macroName === "expand") {
    return `<p><strong>${escapeHtml(title || "Details")}</strong></p>${rich ?? ""}`;
  }
  if (macroName === "jira") {
    const key = params.get("key")?.trim();
    if (key) return `<span>${escapeHtml(key)}</span>`;
    const jql = params.get("jqlquery")?.trim();
    if (jql) return `<span>Jira issues: <code>${escapeHtml(jql)}</code></span>`;
    return "<span>[macro: jira]</span>";
  }
  if (DECORATIVE_MACROS.has(macroName)) return "";
  if (rich !== undefined && rich.trim()) return rich;
  if (plainText?.trim())
    return `<pre><code>${escapeHtml(plainText)}</code></pre>`;
  return `<span>[macro: ${escapeHtml(macroName || "unknown")}]</span>`;
}

function unwrapCdata(value: string): string {
  return value.replaceAll(
    /<!\[CDATA\[([\s\S]*?)\]\]>/g,
    (_m, text: string) => text,
  );
}

function textOf(value: string): string {
  return unwrapCdata(value)
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function prepareConfluenceStorage(value: string): string {
  return convertMacros(value)
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
    .replaceAll(/<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/gi, "");
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
