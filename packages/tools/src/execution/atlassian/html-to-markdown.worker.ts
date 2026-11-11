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

/**
 * Text the Markdown converter must not escape (`[ ]`, `[Status]`, `@{id}`) is
 * parked here and swapped back after conversion, via private-use markers.
 */
let stashed: string[] = [];
function stash(text: string): string {
  stashed.push(text);
  return `\uE000${stashed.length - 1}\uE001`;
}
function unstash(markdown: string): string {
  return markdown.replaceAll(
    /\uE000(\d+)\uE001/g,
    (_m, index: string) => stashed[Number(index)] ?? "",
  );
}

const attr = (source: string, name: string): string | undefined => {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(
    source,
  );
  return match ? (match[1] ?? match[2]) : undefined;
};

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
    const inner = match[3] ?? "";
    const reference = /<ri:(?:attachment|page)\b([^>]*)>/i.exec(inner)?.[1];
    const value =
      textOf(inner).trim() ||
      (reference
        ? (attr(reference, "ri:filename") ??
          attr(reference, "ri:content-title") ??
          "")
        : "");
    if (!params.has(key)) params.set(key, value);
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
    return `<span>${stash(`[${label}]`)}</span>`;
  }
  if (macroName in PANEL_LABELS) {
    const label = PANEL_LABELS[macroName];
    const heading = title ? `${label}: ${title}` : `${label}:`;
    return panelHtml(heading, rich ?? "");
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
  const detail = ["diagramname", "name", "title", "filename", "key"]
    .map((key) => params.get(key)?.trim())
    .find(Boolean);
  const placeholder = `[${macroName || "unknown"} macro${detail ? `: ${detail}` : ""}]`;
  return `<span>${stash(placeholder)}</span>`;
}

/** `> **Info:** text`: the label joins the first paragraph. */
function panelHtml(heading: string, body: string): string {
  const label = `<strong>${escapeHtml(heading)}</strong>`;
  const merged = /^\s*<p>/i.test(body)
    ? body.replace(/^\s*<p>/i, `<p>${label} `)
    : `<p>${label}</p>${body}`;
  return `<blockquote>${merged}</blockquote>`;
}

function unwrapCdata(value: string): string {
  return value.replaceAll(
    /<!\[CDATA\[([\s\S]*?)\]\]>/g,
    (_m, text: string) => text,
  );
}

const TEXT_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** Plain text of a parameter value; callers escape it before re-embedding. */
function textOf(value: string): string {
  let text = unwrapCdata(value);
  // Repeat until stable so tags rebuilt by a removal (`<<b>i>`) go too.
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replaceAll(/<[^>]*>/g, "");
  }
  // One pass, so `&amp;lt;` decodes to `&lt;`, not `<`.
  return text.replaceAll(
    /&(?:amp|lt|gt|quot|#39);/g,
    (entity) => TEXT_ENTITIES[entity],
  );
}

const linkLabel = (inner: string): string | undefined =>
  textOf(
    /<ac:(?:plain-text-link-body|link-body)\b[^>]*>([\s\S]*?)<\/ac:(?:plain-text-link-body|link-body)>/i.exec(
      inner,
    )?.[1] ?? "",
  ).trim() || undefined;

/** `<ac:link>`: mentions become `@{accountId}` (named later by the host), other links Markdown links. */
function renderLink(attrs: string, inner: string): string {
  const user = /<ri:user\b([^>]*)>/i.exec(inner)?.[1];
  if (user !== undefined) {
    const who =
      attr(user, "ri:account-id") ??
      attr(user, "ri:userkey") ??
      attr(user, "ri:username") ??
      "user";
    return stash(`@{${who}}`);
  }
  const label = linkLabel(inner);
  const anchor = attr(attrs, "ac:anchor");
  const page = /<ri:page\b([^>]*)>/i.exec(inner)?.[1];
  if (page !== undefined) {
    const title = attr(page, "ri:content-title") ?? "";
    return stash(
      `[${label ?? title}](page:${title.replaceAll(" ", "%20")}${anchor ? `#${anchor}` : ""})`,
    );
  }
  const file = /<ri:attachment\b([^>]*)>/i.exec(inner)?.[1];
  if (file !== undefined) {
    const name = attr(file, "ri:filename") ?? "";
    return stash(
      `[${label ?? name}](attachment:${name.replaceAll(" ", "%20")})`,
    );
  }
  if (anchor) return stash(`[${label ?? anchor}](#${anchor})`);
  return escapeHtml(label ?? "");
}

/** Cloud-only `<ac:adf-extension>`: decision lists and custom panels; others are named. */
function renderAdf(inner: string): string {
  const body = inner.replace(
    /<ac:adf-fallback\b[\s\S]*<\/ac:adf-fallback>/i,
    "",
  );
  const type = /<ac:adf-node\b[^>]*\btype="([^"]*)"/i.exec(body)?.[1] ?? "";
  if (type === "decision-list") {
    const items = [
      ...body.matchAll(
        /<ac:adf-node\b[^>]*\btype="decision-item"[^>]*>([\s\S]*?)<\/ac:adf-node>/gi,
      ),
    ].map((m) => {
      const state = /<ac:adf-attribute\b[^>]*\bkey="state"[^>]*>([^<]*)</i
        .exec(m[1])?.[1]
        .trim()
        .toUpperCase();
      const text =
        /<ac:adf-content\b[^>]*>([\s\S]*?)<\/ac:adf-content>/i.exec(m[1])?.[1] ??
        "";
      return `<li>${stash(state === "UNDECIDED" ? "[undecided] " : "[decided] ")}${text}</li>`;
    });
    return `<ul>${items.join("")}</ul>`;
  }
  if (type === "panel") {
    const content =
      /<ac:adf-content\b[^>]*>([\s\S]*)<\/ac:adf-content>/i.exec(body)?.[1] ??
      "";
    return panelHtml("Panel:", content);
  }
  return `<span>${stash(`[${type || "adf"} block]`)}</span>`;
}

function prepareConfluenceStorage(value: string): string {
  const renderTask = (task: string): string => {
    const done = /<ac:task-status>\s*complete\s*<\/ac:task-status>/i.test(task);
    const text =
      /<ac:task-body\b[^>]*>([\s\S]*?)<\/ac:task-body>/i.exec(task)?.[1] ?? "";
    return `<li>${stash(done ? "[x] " : "[ ] ")}${text}</li>`;
  };
  return convertMacros(value)
    .replaceAll(
      /<ac:adf-extension\b[^>]*>([\s\S]*?)<\/ac:adf-extension>/gi,
      (_m, inner: string) => renderAdf(inner),
    )
    .replaceAll(
      /<ac:task-list\b[^>]*>([\s\S]*?)<\/ac:task-list>/gi,
      (_m, inner: string) =>
        `<ul>${[...inner.matchAll(/<ac:task\b[^>]*>[\s\S]*?<\/ac:task>/gi)].map((t) => renderTask(t[0])).join("")}</ul>`,
    )
    .replaceAll(
      /<ac:link\b([^>]*)>([\s\S]*?)<\/ac:link>/gi,
      (_m, attrs: string, inner: string) => renderLink(attrs, inner),
    )
    .replaceAll(
      /<time\b[^>]*?datetime\s*=\s*"([^"]*)"[^>]*?(?:\/>|>\s*<\/time>)/gi,
      (_m, date: string) => escapeHtml(date),
    )
    .replaceAll(/<ac:emoticon\b([^>]*)\/?>/gi, (_m, attrs: string) =>
      escapeHtml(
        attr(attrs, "ac:emoji-fallback") ??
          `:${attr(attrs, "ac:name") ?? "emoji"}:`,
      ),
    )
    .replaceAll(
      /<ac:image\b([^>]*)>([\s\S]*?)<\/ac:image>/gi,
      (_m, attrs: string, inner: string) => {
        const file = /<ri:attachment\b([^>]*)>/i.exec(inner)?.[1];
        const link = /<ri:url\b([^>]*)>/i.exec(inner)?.[1];
        const target =
          (file && attr(file, "ri:filename")) ||
          (link && attr(link, "ri:value")) ||
          "";
        const alt = attr(attrs, "ac:alt") ?? target;
        return `<p>${stash(`![${alt.replaceAll("]", "\\]")}](${target.replaceAll(" ", "%20")})`)}</p>`;
      },
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

function execute(input: WorkerInput): WorkerResult {
  stashed = [];
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
    const markdown = unstash(converter.translate(source)).trim();
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
