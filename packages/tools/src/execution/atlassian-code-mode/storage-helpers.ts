import { markdownToStorage } from "../confluence/markdown-to-storage.js";

/**
 * `storage.*`: string builders for Confluence storage XHTML, pure JS in the
 * sandbox (no host calls). The Markdown converter lives only host-side, so
 * `storage.markdown(md)` returns an opaque placeholder string that
 * `pages.create`/`pages.update`/`comments.add` expand with the converter before
 * sending. Scripts must therefore treat helper output as opaque and only
 * concatenate it (no regex/replace on it).
 */
export const MARKDOWN_MARKER_START = "\u0001md:";
export const MARKDOWN_MARKER_END = "\u0002";

/** Expands `storage.markdown()` placeholders into storage XHTML. */
export function expandMarkdownMarkers(text: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const start = text.indexOf(MARKDOWN_MARKER_START, from);
    const end =
      start < 0
        ? -1
        : text.indexOf(
            MARKDOWN_MARKER_END,
            start + MARKDOWN_MARKER_START.length,
          );
    if (start < 0 || end < 0) return out + text.slice(from);
    const encoded = text.slice(start + MARKDOWN_MARKER_START.length, end);
    out +=
      text.slice(from, start) + markdownToStorage(decodeURIComponent(encoded));
    from = end + MARKDOWN_MARKER_END.length;
  }
}

export function hasMarkdownMarkers(text: string): boolean {
  return text.includes(MARKDOWN_MARKER_START);
}

export const STORAGE_INDEX = [
  'storage.markdown(md), .escape(text), .toc(), .panel("info"|"note"|"warning"|"tip"|"success", body, { title? }), .expand(title, body),',
  '.status(text, "Grey"|"Red"|"Yellow"|"Green"|"Blue"|"Purple"), .code(code, { language?, title? }), .jiraIssue(key), .jiraIssues(jql, { columns? }),',
  '.table(rows: object[] | string[][], { columns? })  // strings: concatenate into a `format: "storage"` body; body args take Markdown or storage',
].join("\n");

export const STORAGE_PRELUDE = String.raw`globalThis.storage = (() => {
  const START = "\u0001md:";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cdata = (s) => "<![CDATA[" + String(s).split("]]>").join("]]]]><![CDATA[>") + "]]>";
  const markdown = (md) => START + encodeURIComponent(String(md)) + "\u0002";
  const isStorage = (s) => /^\s*</.test(s) || s.includes(START);
  const rich = (b) => { const s = String(b == null ? "" : b); return isStorage(s) ? s : markdown(s); };
  const param = (name, value) => value == null || value === "" ? "" : '<ac:parameter ac:name="' + name + '">' + esc(value) + "</ac:parameter>";
  const macro = (name, params, body) =>
    '<ac:structured-macro ac:name="' + name + '" ac:schema-version="1">' + params + (body || "") + "</ac:structured-macro>";
  const richBody = (b) => "<ac:rich-text-body>" + rich(b) + "</ac:rich-text-body>";
  const cell = (tag, v) => {
    const s = String(v == null ? "" : v);
    return "<" + tag + ">" + (isStorage(s) ? s : "<p>" + esc(s) + "</p>") + "</" + tag + ">";
  };
  const PANELS = { info: "info", note: "note", warning: "warning", tip: "tip", success: "tip" };
  const COLOURS = { grey: "Grey", gray: "Grey", red: "Red", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple" };
  return {
    markdown,
    escape: esc,
    toc: () => macro("toc", ""),
    panel: (type, body, opts) => {
      const name = PANELS[String(type)];
      if (!name) throw new Error("panel type must be one of: info, note, warning, tip, success");
      return macro(name, param("title", opts && opts.title), richBody(body));
    },
    expand: (title, body) => macro("expand", param("title", title), richBody(body)),
    status: (text, colour) =>
      macro("status", param("title", text) + param("colour", COLOURS[String(colour || "grey").toLowerCase()] || "Grey")),
    code: (code, opts) =>
      macro("code", param("language", opts && opts.language) + param("title", opts && opts.title), "<ac:plain-text-body>" + cdata(code) + "</ac:plain-text-body>"),
    jiraIssue: (key) => macro("jira", param("key", key)),
    jiraIssues: (jql, opts) => {
      const columns = opts && opts.columns;
      return macro("jira", param("jqlQuery", jql) + param("columns", Array.isArray(columns) ? columns.join(",") : columns));
    },
    table: (rows, opts) => {
      const list = Array.isArray(rows) ? rows : [];
      let header;
      let body;
      if (list.length > 0 && Array.isArray(list[0])) {
        const given = opts && opts.columns;
        header = given || list[0];
        body = given ? list : list.slice(1);
      } else {
        header = (opts && opts.columns) || (list.length ? Object.keys(list[0]) : []);
        body = list.map((r) => header.map((h) => r[h]));
      }
      return "<table><tbody><tr>" + header.map((h) => cell("th", h)).join("") + "</tr>" +
        body.map((r) => "<tr>" + header.map((_, i) => cell("td", r[i])).join("") + "</tr>").join("") + "</tbody></table>";
    },
  };
})();`;
