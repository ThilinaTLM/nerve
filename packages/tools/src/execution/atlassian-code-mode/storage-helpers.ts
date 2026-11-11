import { MARKDOWN_SANDBOX_SOURCE } from "../confluence/markdown-to-storage.js";

/**
 * `storage.*`: string builders for Confluence storage XHTML, pure JS in the
 * sandbox (no host calls). `storage.markdown(md)` runs the same Markdown
 * converter the host uses (its source is evaluated first), so it returns real
 * storage markup synchronously and helper output can be treated as plain strings.
 */
const STORAGE_BUILDERS = String.raw`globalThis.storage = (() => {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cdata = (s) => "<![CDATA[" + String(s).split("]]>").join("]]]]><![CDATA[>") + "]]>";
  const markdown = (md) => __markdownToStorage(String(md));
  const isStorage = (s) => /^\s*</.test(s);
  const hasTag = (s) => /<\/?[a-z][\w:-]*[\s\/>]/i.test(s);
  const rich1 = (b) => { const s = String(b == null ? "" : b); return isStorage(s) ? s : markdown(s); };
  const rich = (b) => Array.isArray(b) ? b.map(rich1).join("") : rich1(b);
  const param = (name, value) => value == null || value === "" ? "" : '<ac:parameter ac:name="' + name + '">' + esc(value) + "</ac:parameter>";
  const macro = (name, params, body, attrs) =>
    '<ac:structured-macro ac:name="' + name + '" ac:schema-version="1"' + (attrs || "") + ">" + params + (body || "") + "</ac:structured-macro>";
  const richBody = (b) => "<ac:rich-text-body>" + rich(b) + "</ac:rich-text-body>";
  const cell = (tag, v) => {
    const s = String(v == null ? "" : v);
    return "<" + tag + ">" + (isStorage(s) ? s : "<p>" + (hasTag(s) ? s : esc(s)) + "</p>") + "</" + tag + ">";
  };
  let taskId = 0;
  const LAYOUTS = { two_equal: 1, two_left_sidebar: 1, two_right_sidebar: 1, three_equal: 1 };
  const LAYOUT_NAMES = { default: 1, wide: 1, "full-width": 1 };
  const layoutAttr = (layout) => {
    const l = layout || "default";
    if (!LAYOUT_NAMES[l]) throw new Error("layout must be one of: default, wide, full-width");
    return ' data-layout="' + l + '"';
  };
  // Confluence Cloud panel names -> storage macros (legacy colours: info blue, tip green, note yellow, warning red).
  const PANELS = { info: "info", success: "tip", tip: "tip", warning: "note", error: "warning", note: "panel" };
  const NOTE_PANEL = param("borderStyle", "solid") + param("borderColor", "#998DD9") + param("bgColor", "#EAE6FF");
  const COLOURS = { grey: "Grey", gray: "Grey", red: "Red", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple" };
  return {
    markdown,
    escape: esc,
    h1: (text) => "<h1>" + esc(text) + "</h1>",
    h2: (text) => "<h2>" + esc(text) + "</h2>",
    h3: (text) => "<h3>" + esc(text) + "</h3>",
    p: (body) => {
      const t = String(body == null ? "" : body);
      return "<p>" + (hasTag(t) ? t : esc(t)) + "</p>";
    },
    link: (url, text) => '<a href="' + esc(url) + '">' + esc(text == null ? url : text) + "</a>",
    date: (iso) => '<time datetime="' + esc(iso) + '"/>',
    mention: (accountId) => '<ac:link><ri:user ri:account-id="' + esc(accountId) + '"/></ac:link>',
    tasks: (items) =>
      "<ac:task-list>" + items.map((item) => {
        const t = typeof item === "string" ? { text: item } : item;
        return "<ac:task><ac:task-id>" + (++taskId) + "</ac:task-id><ac:task-status>" + (t.done ? "complete" : "incomplete") +
          "</ac:task-status><ac:task-body>" + (hasTag(String(t.text)) ? t.text : esc(t.text)) + "</ac:task-body></ac:task>";
      }).join("") + "</ac:task-list>",
    image: (filename, opts) => {
      const o = opts || {};
      return '<ac:image ac:align="' + esc(o.align || "center") + '"' + (o.width ? ' ac:width="' + Math.round(o.width) + '"' : "") +
        (o.alt ? ' ac:alt="' + esc(o.alt) + '"' : "") + '><ri:attachment ri:filename="' + esc(filename) + '"/>' +
        (o.caption ? "<ac:caption><p>" + esc(o.caption) + "</p></ac:caption>" : "") + "</ac:image>";
    },
    layout: (cells, opts) => {
      const type = (opts && opts.type) || (cells.length === 3 ? "three_equal" : "two_equal");
      if (!LAYOUTS[type]) throw new Error("layout type must be one of: two_equal, two_left_sidebar, two_right_sidebar, three_equal");
      const want = type === "three_equal" ? 3 : 2;
      if (cells.length !== want) throw new Error("layout type " + type + " needs " + want + " cells");
      return '<ac:layout><ac:layout-section ac:type="' + type + '">' +
        cells.map((c) => "<ac:layout-cell>" + rich(c) + "</ac:layout-cell>").join("") + "</ac:layout-section></ac:layout>";
    },
    toc: () => macro("toc", ""),
    panel: (type, body, opts) => {
      const name = PANELS[String(type)];
      if (!name) throw new Error("panel type must be one of: info, note, success, warning, error");
      return macro(name, (String(type) === "note" ? NOTE_PANEL : "") + param("title", opts && opts.title), richBody(body));
    },
    expand: (title, body) => macro("expand", param("title", title), richBody(body)),
    status: (text, colour) =>
      macro("status", param("title", text) + param("colour", COLOURS[String(colour || "grey").toLowerCase()] || "Grey")),
    code: (code, opts) =>
      macro("code", param("language", opts && opts.language) + param("title", opts && opts.title), "<ac:plain-text-body>" + cdata(code) + "</ac:plain-text-body>"),
    jiraIssue: (key) => macro("jira", param("key", key)),
    jiraIssues: (jql, opts) => {
      const o = opts || {};
      const columns = Array.isArray(o.columns) ? o.columns : typeof o.columns === "string" ? o.columns.split(/[,;]/) : [];
      return macro("jira",
        param("jqlQuery", jql) + param("columns", columns.map((c) => String(c).trim()).filter(Boolean).join(";")) +
        param("maximumIssues", o.limit || o.maximumIssues) + param("serverId", o.serverId),
        "", layoutAttr(o.layout));
    },
    table: (rows, opts) => {
      const list = Array.isArray(rows) ? rows : [];
      const given = ((opts && opts.columns) || []).map((c) => (typeof c === "string" ? { key: c } : c));
      let header;
      let body;
      if (list.length > 0 && Array.isArray(list[0])) {
        header = given.length ? given.map((c) => c.title || c.key) : list[0];
        body = given.length ? list : list.slice(1);
      } else {
        const keys = given.length ? given.map((c) => c.key) : (list.length ? Object.keys(list[0]) : []);
        header = given.length ? given.map((c) => c.title || c.key) : keys;
        body = list.map((r) => keys.map((k) => r[k]));
      }
      const layout = (opts && opts.layout) || "default";
      const total = { default: 760, wide: 960, "full-width": 1800 }[layout] || 760;
      let cols = "";
      if (given.some((c) => c.width)) {
        const known = given.reduce((n, c) => n + (c.width || 0), 0);
        const missing = given.filter((c) => !c.width).length;
        const rest = missing ? Math.max(56, Math.floor((total - known) / missing)) : 0;
        cols = "<colgroup>" + given.map((c) => '<col style="width: ' + (c.width || rest) + 'px;"/>').join("") + "</colgroup>";
      }
      return '<table data-layout="' + esc(layout) + '">' + cols + "<tbody><tr>" + header.map((h) => cell("th", h)).join("") + "</tr>" +
        body.map((r) => "<tr>" + header.map((_, i) => cell("td", r[i])).join("") + "</tr>").join("") + "</tbody></table>";
    },
  };
})();`;

export const STORAGE_PRELUDE = `${MARKDOWN_SANDBOX_SOURCE}\n${STORAGE_BUILDERS}`;
