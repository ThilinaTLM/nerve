import { MARKDOWN_SANDBOX_SOURCE } from "../../extensions/atlassian/confluence/markdown-to-storage.js";

/**
 * `storage.*`: pure JS in the sandbox (no host calls) for Confluence storage
 * XHTML, plus the RichText wrappers around `confluence.*` writes.
 *
 * RichText = a plain string (Markdown; HTML in it is escaped) | builder output
 * (trusted markup) | an array of those, joined. Trust is tracked by string
 * equality in a per-run set: builder output, `storage.raw(...)` and
 * `pages.get({ body: "storage" })` results are trusted. The host only ever
 * receives storage XHTML: the wrappers of `pages.create/update` and
 * `comments.add` convert RichText here, before the call, so trust never has to
 * cross the JSON bridge. An untrusted string that is really storage XHTML
 * (concatenation loses trust) is rejected instead of being escaped silently.
 */
const STORAGE_BUILDERS = String.raw`globalThis.storage = (() => {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const unesc = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]);
  const cdata = (s) => "<![CDATA[" + String(s).split("]]>").join("]]]]><![CDATA[>") + "]]>";
  const trusted = new Set();
  const T = (s) => { trusted.add(s); return s; };
  const raw = (xhtml) => T(String(xhtml));
  const ids = { taskId: 1 };
  const text = (v) => (v == null ? "" : String(v));
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const uuid = () => hex(8) + "-" + hex(4) + "-4" + hex(3) + "-a" + hex(3) + "-" + hex(12);
  // A string that is storage XHTML but not trusted: markup in it would be escaped, so refuse instead.
  const looksLikeStorage = (s) => {
    const t = s.replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, "").replace(/\x60[^\x60\n]*\x60/g, "");
    return /<\/?(ac|ri):[a-z-]+/i.test(t) || /^\s*<(p|h[1-6]|ul|ol|table|div|blockquote)[\s>\/]/i.test(t);
  };
  const markdown = (md) => {
    if (looksLikeStorage(md)) {
      throw new Error("This string is storage XHTML but not trusted markup (concatenating with + or editing a trusted string loses trust, and plain strings are Markdown). Pass an array [page.body, storage.p(...)] to append, use storage.replaceSection(page.body, heading, content), or wrap hand-written XHTML in storage.raw(xhtml). For literal HTML in Markdown, put it in backticks.");
    }
    return T(__markdownToStorage(md, ids));
  };
  // Inline content: trusted fragments as-is, anything else literal text (escaped); arrays are joined.
  const inline = (b) => Array.isArray(b) ? b.map(inline).join("") : trusted.has(b) ? b : esc(text(b));
  // Block content (RichText): trusted fragments as-is, plain strings are Markdown; arrays are joined.
  const rich = (b) => Array.isArray(b) ? b.map(rich).join("") : trusted.has(b) ? b : markdown(text(b));
  const param = (name, value) => value == null || value === "" ? "" : '<ac:parameter ac:name="' + name + '">' + esc(value) + "</ac:parameter>";
  const macro = (name, params, body, attrs) =>
    T('<ac:structured-macro ac:name="' + name + '" ac:schema-version="1"' + (attrs || "") + ">" + params + (body || "") + "</ac:structured-macro>");
  const richBody = (b) => "<ac:rich-text-body>" + rich(b) + "</ac:rich-text-body>";
  const cellBody = (v) => Array.isArray(v) ? v.map(cellBody).join("") : trusted.has(v) ? v : "<p>" + esc(text(v)) + "</p>";
  const isCellObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const span = (v) => (isCellObject(v) ? Math.max(1, Math.round(Number(v.colspan)) || 1) : 1);
  const cell = (tag, v) => {
    if (!isCellObject(v)) return "<" + tag + ">" + cellBody(v) + "</" + tag + ">";
    const rows = Math.round(Number(v.rowspan)) || 1;
    return "<" + tag + (span(v) > 1 ? ' colspan="' + span(v) + '"' : "") + (rows > 1 ? ' rowspan="' + rows + '"' : "") + ">" + cellBody(v.text) + "</" + tag + ">";
  };
  const width = (w) => {
    const n = Number(w);
    if (!Number.isFinite(n) || n <= 0) throw new Error("column width must be a positive number of pixels");
    return Math.round(n);
  };
  const url = (u) => {
    const s = text(u);
    if (!__isSafeUrl(s)) throw new Error("unsupported URL: only http(s), mailto, relative and anchor links are allowed");
    return s;
  };
  const LAYOUTS = { two_equal: 2, two_left_sidebar: 2, two_right_sidebar: 2, three_equal: 3, three_with_sidebars: 3 };
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
  const flag = (v) => (v ? "true" : "");
  // <ri:...> reference for links and macros: a page by title, an attachment by filename.
  const pageRef = (title, space) => '<ri:page ri:content-title="' + esc(title) + '"' + (space ? ' ri:space-key="' + esc(space) + '"' : "") + "/>";
  const linkBody = (label) => (label == null ? "" : "<ac:plain-text-link-body>" + cdata(label) + "</ac:plain-text-link-body>");
  const guardText = (v, what) => { if (typeof v !== "string" || !v.trim()) throw new Error(what + " must be a non-empty string"); return v; };

  const table = (rows, opts) => {
    const o = opts || {};
    const list = Array.isArray(rows) ? rows : [];
    const given = (o.columns || []).map((c) => (typeof c === "string" ? { key: c } : { ...c, width: c.width == null ? 0 : width(c.width) }));
    const arrays = list.length > 0 && Array.isArray(list[0]);
    let header;
    let body;
    if (arrays) {
      header = given.length ? given.map((c) => c.title || c.key) : o.headerRow === false ? [] : list[0];
      body = given.length || o.headerRow === false ? list : list.slice(1);
    } else {
      const keys = given.length ? given.map((c) => c.key) : (list.length ? Object.keys(list[0]) : []);
      header = given.length ? given.map((c) => c.title || c.key) : keys;
      body = list.map((r) => keys.map((k) => r[k]));
    }
    const count = header.length || Math.max(0, ...body.map((r) => r.length));
    const layout = o.layout || "default";
    if (!LAYOUT_NAMES[layout]) throw new Error("layout must be one of: default, wide, full-width");
    const total = { default: 760, wide: 960, "full-width": 1800 }[layout];
    let cols = "";
    if (given.some((c) => c.width)) {
      const known = given.reduce((n, c) => n + (c.width || 0), 0);
      const missing = given.filter((c) => !c.width).length;
      const rest = missing ? Math.max(56, Math.floor((total - known) / missing)) : 0;
      cols = "<colgroup>" + given.map((c) => '<col style="width: ' + (c.width || rest) + 'px;"/>').join("") + "</colgroup>";
    }
    const head = o.headerRow === false ? "" : "<tr>" + header.map((h) => cell("th", h)).join("") + "</tr>";
    const row = (r) => {
      const used = r.reduce((n, v) => n + span(v), 0);
      const cells = r.concat(Array(Math.max(0, count - used)).fill(""));
      return "<tr>" + cells.map((v, i) => cell(o.headerColumn && i === 0 ? "th" : "td", v)).join("") + "</tr>";
    };
    return T('<table data-layout="' + layout + '">' + cols + "<tbody>" + head + body.map(row).join("") + "</tbody></table>");
  };

  // ---- sections: replaceSection finds headings with their nesting depth ----
  const TAG = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  const headings = (xml) => {
    const found = [];
    const closes = [];
    const open = [];
    let depth = 0;
    for (const m of xml.matchAll(TAG)) {
      if (m[2] === undefined) continue;
      const level = /^h([1-6])$/.exec(m[2]);
      if (m[1]) {
        depth -= 1;
        const head = open.at(-1);
        if (level && head && head.level === Number(level[1]) && head.depth === depth) {
          head.end = m.index + m[0].length;
          head.text = unesc(xml.slice(head.tagEnd, m.index).replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
          open.pop();
        }
        closes.push({ index: m.index, depth });
      } else if (!m[3].endsWith("/")) {
        if (level) {
          const head = { level: Number(level[1]), depth, start: m.index, tagEnd: m.index + m[0].length, end: -1, text: "" };
          found.push(head);
          open.push(head);
        }
        depth += 1;
      }
    }
    return { found: found.filter((h) => h.end > 0), closes };
  };
  const replaceSection = (body, heading, content) => {
    const xml = rich(body);
    const { found, closes } = headings(xml);
    const at = found.findIndex((h) => h.text === String(heading).trim());
    if (at < 0) {
      const names = found.slice(0, 40).map((h) => h.text).join(" | ");
      throw new Error("no heading \"" + heading + "\" in the body. Headings: " + (names || "(none)"));
    }
    const h = found[at];
    let end = xml.length;
    const next = found.slice(at + 1).find((n) => n.depth === h.depth && n.level <= h.level);
    if (next) end = next.start;
    const close = closes.find((c) => c.index >= h.end && c.depth < h.depth);
    if (close && close.index < end) end = close.index;
    return T(xml.slice(0, h.end) + rich(content) + xml.slice(end));
  };

  // ---- RichText on the host-facing writes ----
  const withBody = (options) =>
    options !== null && typeof options === "object" && !Array.isArray(options) && options.body !== undefined
      ? { ...options, body: rich(options.body) }
      : options;
  const wrapHost = () => {
    const c = globalThis.confluence;
    if (!c || !c.pages || !c.comments) return;
    for (const [group, name] of [["pages", "create"], ["pages", "update"], ["comments", "add"], ["comments", "reply"], ["comments", "update"]]) {
      const original = c[group][name];
      c[group][name] = (options) => original(withBody(options));
    }
    const get = c.pages.get;
    c.pages.get = async (options) => {
      const page = await get(options);
      if (options && options.body === "storage" && page && typeof page.body === "string") T(page.body);
      return page;
    };
  };
  wrapHost();

  return {
    raw,
    escape: esc,
    replaceSection,
    heading: (level, v) => {
      const n = Number(level);
      if (!Number.isInteger(n) || n < 1 || n > 6) throw new Error("heading level must be 1-6");
      return T("<h" + n + ">" + esc(text(v)) + "</h" + n + ">");
    },
    p: (body) => T("<p>" + inline(body == null ? "" : body) + "</p>"),
    link: (target, label) => {
      if (typeof target === "string") return T('<a href="' + esc(url(target)) + '">' + esc(label == null ? target : label) + "</a>");
      const t = target || {};
      const anchor = t.anchor ? ' ac:anchor="' + esc(t.anchor) + '"' : "";
      if (t.page) return T("<ac:link" + anchor + ">" + pageRef(guardText(t.page, "page"), t.space) + linkBody(label == null ? t.page : label) + "</ac:link>");
      if (t.attachment) return T("<ac:link><ri:attachment ri:filename=\"" + esc(t.attachment) + "\"/>" + linkBody(label == null ? t.attachment : label) + "</ac:link>");
      if (t.anchor) return T("<ac:link" + anchor + ">" + linkBody(label == null ? t.anchor : label) + "</ac:link>");
      throw new Error("link target is a URL string, { page, space?, anchor? }, { attachment } or { anchor }");
    },
    anchor: (name) => macro("anchor", param("", guardText(name, "anchor name"))),
    date: (iso) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text(iso))) throw new Error("date must be YYYY-MM-DD");
      return T('<time datetime="' + iso + '"/>');
    },
    mention: (accountId) => T('<ac:link><ri:user ri:account-id="' + esc(accountId) + '"/></ac:link>'),
    tasks: (items) =>
      T("<ac:task-list>" + items.map((item) => {
        const t = typeof item === "object" && item !== null && !Array.isArray(item) ? item : { text: item };
        return "<ac:task><ac:task-id>" + (ids.taskId++) + "</ac:task-id><ac:task-status>" + (t.done ? "complete" : "incomplete") +
          "</ac:task-status><ac:task-body>" + inline(t.text) + "</ac:task-body></ac:task>";
      }).join("") + "</ac:task-list>"),
    decisions: (items) => {
      const norm = items.map((item) => typeof item === "object" && item !== null && !Array.isArray(item) && !trusted.has(item) ? item : { text: item });
      const li = (v) => "<li>" + inline(v.text) + "</li>";
      return T('<ac:adf-extension><ac:adf-node type="decision-list"><ac:adf-attribute key="local-id">' + uuid() + "</ac:adf-attribute>" +
        norm.map((v) => '<ac:adf-node type="decision-item"><ac:adf-attribute key="local-id">' + uuid() +
          '</ac:adf-attribute><ac:adf-attribute key="state">' + (v.done === false ? "UNDECIDED" : "DECIDED") + '</ac:adf-attribute><ac:adf-content>' + inline(v.text) + "</ac:adf-content></ac:adf-node>").join("") +
        '</ac:adf-node><ac:adf-fallback><ul class="decision-list">' + norm.map(li).join("") + "</ul></ac:adf-fallback></ac:adf-extension>");
    },
    image: (source, opts) => {
      const o = opts || {};
      const external = /^https?:\/\//i.test(text(source));
      const ref = external ? '<ri:url ri:value="' + esc(url(source)) + '"/>' : '<ri:attachment ri:filename="' + esc(source) + '"/>';
      const img = '<ac:image ac:align="' + esc(o.align || "center") + '"' + (o.width ? ' ac:width="' + Math.round(o.width) + '"' : "") +
        (o.border ? ' ac:border="true"' : "") + (o.alt ? ' ac:alt="' + esc(o.alt) + '"' : "") + ">" + ref +
        (o.caption ? "<ac:caption><p>" + esc(o.caption) + "</p></ac:caption>" : "") + "</ac:image>";
      return T(o.link ? '<a href="' + esc(url(o.link)) + '">' + img + "</a>" : img);
    },
    viewFile: (filename, opts) =>
      macro("view-file", '<ac:parameter ac:name="name"><ri:attachment ri:filename="' + esc(filename) + '"/></ac:parameter>' + param("height", opts && opts.height)),
    layout: (cells, opts) => {
      const type = (opts && opts.type) || (cells.length === 3 ? "three_equal" : "two_equal");
      if (!LAYOUTS[type]) throw new Error("layout type must be one of: " + Object.keys(LAYOUTS).join(", "));
      if (cells.length !== LAYOUTS[type]) throw new Error("layout type " + type + " needs " + LAYOUTS[type] + " cells");
      return T('<ac:layout><ac:layout-section ac:type="' + type + '">' +
        cells.map((c) => "<ac:layout-cell>" + rich(c) + "</ac:layout-cell>").join("") + "</ac:layout-section></ac:layout>");
    },
    toc: (opts) => macro("toc", param("minLevel", opts && opts.minLevel) + param("maxLevel", opts && opts.maxLevel)),
    children: (opts) => macro("children", param("depth", opts && opts.depth) + param("all", flag(opts && opts.all))),
    attachments: () => macro("attachments", ""),
    excerpt: (body, opts) => macro("excerpt", param("hidden", flag(opts && opts.hidden)), richBody(body)),
    excerptInclude: (page, opts) =>
      macro("excerpt-include", '<ac:parameter ac:name=""><ac:link>' + pageRef(guardText(page, "page title"), opts && opts.space) + "</ac:link></ac:parameter>" + param("nopanel", flag(opts && opts.noPanel))),
    pageProperties: (props, opts) => {
      const rows = Object.entries(props || {}).map(([k, v]) => [k, v]);
      if (!rows.length) throw new Error("pageProperties needs an object of label: value");
      return macro("details", param("hidden", flag(opts && opts.hidden)), "<ac:rich-text-body>" + table(rows, { headerRow: false, headerColumn: true }) + "</ac:rich-text-body>");
    },
    propertiesReport: (label, opts) => {
      const o = opts || {};
      const cql = 'label = "' + String(label).replace(/"/g, "") + '"' + (o.space ? ' and space = "' + String(o.space).replace(/"/g, "") + '"' : "");
      return macro("detailssummary", param("cql", cql) + param("headings", [].concat(o.headings || []).join(",")) + param("pageSize", o.limit));
    },
    panel: (type, body, opts) => {
      const name = PANELS[String(type)];
      if (!name) throw new Error("panel type must be one of: info, note, success, warning, error");
      return macro(name, (String(type) === "note" ? NOTE_PANEL : "") + param("title", opts && opts.title), richBody(body));
    },
    expand: (title, body) => macro("expand", param("title", title), richBody(body)),
    status: (text, colour) =>
      macro("status", param("title", text) + param("colour", COLOURS[String(colour || "grey").toLowerCase()] || "Grey")),
    code: (code, opts) => {
      const o = opts || {};
      return macro("code", param("language", o.language) + param("title", o.title) + param("linenumbers", flag(o.lineNumbers)) + param("collapse", flag(o.collapse)),
        "<ac:plain-text-body>" + cdata(code) + "</ac:plain-text-body>");
    },
    jiraIssue: (key) => macro("jira", param("key", key)),
    jiraIssues: (jql, opts) => {
      const o = opts || {};
      const columns = Array.isArray(o.columns) ? o.columns : typeof o.columns === "string" ? o.columns.split(/[,;]/) : [];
      return macro("jira",
        param("jqlQuery", jql) + param("columns", columns.map((c) => String(c).trim()).filter(Boolean).join(";")) +
        param("maximumIssues", o.limit || o.maximumIssues) + param("serverId", o.serverId),
        "", layoutAttr(o.layout));
    },
    table,
  };
})();`;

export const STORAGE_PRELUDE = `${MARKDOWN_SANDBOX_SOURCE}\n${STORAGE_BUILDERS}`;
