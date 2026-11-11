/**
 * Small, dependency-free Markdown → Confluence storage format (XHTML) converter.
 *
 * Covered: headings, paragraphs, bold/italic/code/strike, links, autolinks,
 * images by URL, nested bullet/ordered lists, task lists (`- [ ]`/`- [x]`),
 * GFM tables (header row), fenced code (code macro), blockquotes, rules,
 * hard breaks and backslash escapes.
 * Known gaps: raw HTML is escaped (not passed through), bare URLs are not
 * auto-linked, table column alignment is ignored, reference-style links and
 * footnotes are unsupported, setext headings are unsupported.
 */

/**
 * Everything lives inside one function so its source text (`Function.prototype.toString`)
 * is a self-contained program: the quick-script sandbox evaluates the same converter
 * that runs on the host, so RichText strings become real markup synchronously.
 * Keep it dependency-free and use only syntax QuickJS supports.
 */
function createMarkdownConverter() {
  function escapeXml(text: string): string {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  /** CDATA section whose content may contain `]]>`. */
  function cdata(text: string): string {
    return `<![CDATA[${text.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
  }

  /**
   * `state.taskId` numbers `ac:task-id`s; pass one state to every conversion that
   * ends up on the same page so the ids stay unique.
   */
  function markdownToStorage(
    markdown: string,
    state: State = { taskId: 1 },
  ): string {
    return blocks(markdown.replaceAll("\r\n", "\n").split("\n"), state);
  }

  type State = { taskId: number };

  /** http(s), mailto, relative and anchor URLs only (no `javascript:`, `data:`, ...). */
  function isSafeUrl(url: string): boolean {
    // Browsers ignore control characters and spaces inside a scheme.
    const compact = [...url].filter((char) => char > " ").join("");
    return (
      /^(?:https?|mailto):/i.test(compact) ||
      !/^[a-z][a-z0-9+.-]*:/i.test(compact)
    );
  }

  const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
  const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

  function blocks(lines: string[], state: State): string {
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i++;
        continue;
      }
      const fence = FENCE.exec(line);
      if (fence) {
        const marker = fence[1];
        const body: string[] = [];
        i++;
        while (
          i < lines.length &&
          !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(
            lines[i],
          )
        ) {
          body.push(lines[i]);
          i++;
        }
        i++;
        out.push(codeMacro(body.join("\n"), fence[2] || undefined));
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i++;
        continue;
      }
      if (RULE.test(line)) {
        out.push("<hr/>");
        i++;
        continue;
      }
      if (/^ {0,3}>/.test(line)) {
        const quoted: string[] = [];
        while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
          quoted.push(lines[i].replace(/^ {0,3}> ?/, ""));
          i++;
        }
        out.push(`<blockquote>${blocks(quoted, state)}</blockquote>`);
        continue;
      }
      if (
        line.includes("|") &&
        i + 1 < lines.length &&
        TABLE_SEPARATOR.test(lines[i + 1]) &&
        lines[i + 1].includes("-")
      ) {
        const rows: string[][] = [splitRow(line)];
        i += 2;
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          lines[i].includes("|")
        ) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push(tableXml(rows));
        continue;
      }
      if (LIST_ITEM.test(line)) {
        const items: string[] = [];
        while (
          i < lines.length &&
          (LIST_ITEM.test(lines[i]) ||
            (lines[i].trim() === "" &&
              i + 1 < lines.length &&
              LIST_ITEM.test(lines[i + 1])))
        ) {
          if (lines[i].trim() !== "") items.push(lines[i]);
          i++;
        }
        out.push(listXml(items, state));
        continue;
      }
      // Paragraph: until blank line or another block start.
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !startsBlock(lines, i)
      ) {
        para.push(lines[i]);
        i++;
      }
      if (para.length === 0) {
        para.push(lines[i]);
        i++;
      }
      out.push(`<p>${paragraphInline(para)}</p>`);
    }
    return out.join("");
  }

  function startsBlock(lines: string[], index: number): boolean {
    const line = lines[index];
    if (index === 0) return false;
    return (
      FENCE.test(line) ||
      HEADING.test(line) ||
      RULE.test(line) ||
      /^ {0,3}>/.test(line) ||
      LIST_ITEM.test(line) ||
      (line.includes("|") &&
        index + 1 < lines.length &&
        TABLE_SEPARATOR.test(lines[index + 1]) &&
        lines[index + 1].includes("-"))
    );
  }

  function paragraphInline(lines: string[]): string {
    return lines
      .map((line, index) => {
        const hard = index < lines.length - 1 && /( {2,}|\\)$/.test(line);
        const text = hard ? line.replace(/( {2,}|\\)$/, "") : line;
        return inline(text.trim()) + (hard ? "<br/>" : "");
      })
      .join("\n");
  }

  function codeMacro(code: string, language?: string, title?: string): string {
    return (
      `<ac:structured-macro ac:name="code" ac:schema-version="1">` +
      (language
        ? `<ac:parameter ac:name="language">${escapeXml(language)}</ac:parameter>`
        : "") +
      (title
        ? `<ac:parameter ac:name="title">${escapeXml(title)}</ac:parameter>`
        : "") +
      `<ac:plain-text-body>${cdata(code)}</ac:plain-text-body></ac:structured-macro>`
    );
  }

  function splitRow(line: string): string[] {
    let text = line.trim();
    if (text.startsWith("|")) text = text.slice(1);
    if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
    const cells: string[] = [];
    let current = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\\" && text[i + 1] === "|") {
        current += "|";
        i++;
      } else if (ch === "`") {
        // Pipes inside code spans do not split cells.
        const end = text.indexOf("`", i + 1);
        if (end > 0) {
          current += text.slice(i, end + 1);
          i = end;
        } else current += ch;
      } else if (ch === "|") {
        cells.push(current.trim());
        current = "";
      } else current += ch;
    }
    cells.push(current.trim());
    return cells;
  }

  function tableXml(rows: string[][]): string {
    const width = Math.max(...rows.map((row) => row.length));
    const cell = (tag: "th" | "td", row: string[], column: number) =>
      `<${tag}><p>${inline(row[column] ?? "")}</p></${tag}>`;
    const render = (row: string[], tag: "th" | "td") =>
      `<tr>${Array.from({ length: width }, (_, c) => cell(tag, row, c)).join("")}</tr>`;
    const [header, ...body] = rows as [string[], ...string[][]];
    return `<table><tbody>${render(header, "th")}${body.map((row) => render(row, "td")).join("")}</tbody></table>`;
  }

  type Item = {
    indent: number;
    ordered: boolean;
    text: string;
    children: Item[];
  };

  function listXml(lines: string[], state: State): string {
    const root: Item = { indent: -1, ordered: false, text: "", children: [] };
    const stack: Item[] = [root];
    for (const line of lines) {
      const match = LIST_ITEM.exec(line)!;
      const indent = match[1].replaceAll("\t", "    ").length;
      const item: Item = {
        indent,
        ordered: /\d/.test(match[2]),
        text: match[3],
        children: [],
      };
      while (stack.length > 1 && stack.at(-1)!.indent >= indent) stack.pop();
      stack.at(-1)!.children.push(item);
      stack.push(item);
    }
    return renderItems(root.children, state);
  }

  const TASK = /^\[( |x|X)\]\s+(.*)$/;

  function renderItems(items: Item[], state: State): string {
    if (items.length === 0) return "";
    // Group consecutive items of the same kind (bullet vs ordered).
    const groups: Item[][] = [];
    for (const item of items) {
      const last = groups.at(-1);
      if (last && last[0].ordered === item.ordered) last.push(item);
      else groups.push([item]);
    }
    return groups.map((group) => renderGroup(group, state)).join("");
  }

  function renderGroup(group: Item[], state: State): string {
    const isTaskList = group.some((item) => TASK.test(item.text));
    if (isTaskList) {
      return `<ac:task-list>${group
        .map((item) => {
          const match = TASK.exec(item.text);
          const done = match ? match[1] !== " " : false;
          const text = match ? match[2] : item.text;
          const id = state.taskId++;
          return (
            `<ac:task><ac:task-id>${id}</ac:task-id>` +
            `<ac:task-status>${done ? "complete" : "incomplete"}</ac:task-status>` +
            `<ac:task-body>${inline(text)}</ac:task-body></ac:task>` +
            // Nested tasks follow as a sibling task list.
            renderItems(item.children, state)
          );
        })
        .join("")}</ac:task-list>`;
    }
    const tag = group[0].ordered ? "ol" : "ul";
    return `<${tag}>${group
      .map(
        (item) =>
          `<li><p>${inline(item.text)}</p>${renderItems(item.children, state)}</li>`,
      )
      .join("")}</${tag}>`;
  }

  /** Inline Markdown → storage XHTML. */
  function inline(text: string): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (
        ch === "\\" &&
        i + 1 < text.length &&
        /[\\`*_{}[\]()#+\-.!|~<>]/.test(text[i + 1])
      ) {
        out += escapeXml(text[i + 1]);
        i += 2;
        continue;
      }
      if (ch === "`") {
        const run = /^`+/.exec(text.slice(i))![0];
        const end = text.indexOf(run, i + run.length);
        if (end > 0) {
          out += `<code>${escapeXml(text.slice(i + run.length, end).trim())}</code>`;
          i = end + run.length;
          continue;
        }
      }
      if (ch === "!" && text[i + 1] === "[") {
        const link = parseLink(text, i + 1);
        if (link && !isSafeUrl(link.url)) {
          out += escapeXml(link.label);
          i = link.end;
          continue;
        }
        if (link) {
          const alt = link.label ? ` ac:alt="${escapeXml(link.label)}"` : "";
          out += `<ac:image${alt}>${imageTarget(link.url)}</ac:image>`;
          i = link.end;
          continue;
        }
      }
      if (ch === "[") {
        const link = parseLink(text, i);
        if (link && !isSafeUrl(link.url)) {
          out += inline(link.label);
          i = link.end;
          continue;
        }
        if (link) {
          out += `<a href="${escapeXml(link.url)}">${inline(link.label)}</a>`;
          i = link.end;
          continue;
        }
      }
      if (ch === "<") {
        const auto = /^<(https?:\/\/[^\s<>]+)>/.exec(text.slice(i));
        if (auto) {
          out += `<a href="${escapeXml(auto[1])}">${escapeXml(auto[1])}</a>`;
          i += auto[0].length;
          continue;
        }
      }
      const emphasis = matchEmphasis(text, i);
      if (emphasis) {
        out += `${emphasis.open}${inline(emphasis.inner)}${emphasis.close}`;
        i = emphasis.end;
        continue;
      }
      out += escapeXml(ch);
      i++;
    }
    return out;
  }

  function imageTarget(url: string): string {
    return `<ri:url ri:value="${escapeXml(url)}"/>`;
  }

  function parseLink(
    text: string,
    start: number,
  ): { label: string; url: string; end: number } | undefined {
    let depth = 0;
    let i = start;
    for (; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === "[") depth++;
      else if (text[i] === "]" && --depth === 0) break;
    }
    if (i >= text.length || text[i + 1] !== "(") return undefined;
    const label = text.slice(start + 1, i);
    let j = i + 2;
    let parens = 1;
    for (; j < text.length; j++) {
      if (text[j] === "(") parens++;
      else if (text[j] === ")" && --parens === 0) break;
    }
    if (j >= text.length) return undefined;
    const target = text.slice(i + 2, j).trim();
    // Drop an optional "title" part.
    const url = /^(\S+)(?:\s+".*")?$/.exec(target)?.[1];
    if (!url) return undefined;
    return { label, url, end: j + 1 };
  }

  function matchEmphasis(
    text: string,
    i: number,
  ): { open: string; close: string; inner: string; end: number } | undefined {
    const rest = text.slice(i);
    const forms: Array<[string, string, string]> = [
      ["**", "<strong>", "</strong>"],
      ["__", "<strong>", "</strong>"],
      ["~~", '<span style="text-decoration: line-through;">', "</span>"],
      ["*", "<em>", "</em>"],
      ["_", "<em>", "</em>"],
    ];
    for (const [marker, open, close] of forms) {
      if (!rest.startsWith(marker)) continue;
      // Underscores inside words are literal.
      if (marker[0] === "_" && i > 0 && /\w/.test(text[i - 1])) continue;
      const after = rest[marker.length];
      if (after === undefined || /\s/.test(after)) continue;
      let from = marker.length;
      for (;;) {
        const end = rest.indexOf(marker, from);
        if (end < 0) break;
        const before = rest[end - 1];
        const next = rest[end + marker.length];
        const closes =
          before !== undefined &&
          !/\s/.test(before) &&
          before !== "\\" &&
          !(marker.length === 1 && next === marker) &&
          !(marker[0] === "_" && next !== undefined && /\w/.test(next));
        if (closes && end > marker.length) {
          return {
            open,
            close,
            inner: rest.slice(marker.length, end),
            end: i + end + marker.length,
          };
        }
        from = end + marker.length;
      }
    }
    return undefined;
  }

  return { markdownToStorage, isSafeUrl };
}

export const { markdownToStorage } = createMarkdownConverter();

/** Classic-script source that defines `globalThis.__markdownToStorage` and `__isSafeUrl` (esbuild's `__name` helper is stubbed). */
export const MARKDOWN_SANDBOX_SOURCE = `var __name = (target) => target;
var __converter = (${createMarkdownConverter.toString()})();
globalThis.__markdownToStorage = __converter.markdownToStorage;
globalThis.__isSafeUrl = __converter.isSafeUrl;`;
