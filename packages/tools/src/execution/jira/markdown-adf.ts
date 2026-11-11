import type { AdfDocument } from "./adf.js";

type Node = Record<string, unknown>;

/**
 * Markdown → ADF for Jira descriptions and comments: headings, paragraphs,
 * (nested) bullet and numbered lists, fenced code, block quotes, rules, GFM
 * tables and the
 * inline marks bold, italic, strike, code and links. Anything else stays text,
 * so the result is always valid ADF. The inverse of `adfToMarkdown`.
 */
export function markdownToAdf(markdown: string): AdfDocument {
  const content = parseBlocks(markdown.replaceAll("\r\n", "\n").split("\n"));
  return {
    type: "doc",
    version: 1,
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;

function parseBlocks(lines: string[]): Node[] {
  const out: Node[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    out.push({ type: "paragraph", content: inlineLines(paragraph) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i += 1;
      const closing = new RegExp(
        `^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`,
      );
      while (i < lines.length && !closing.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      out.push({
        type: "codeBlock",
        ...(fence[2] ? { attrs: { language: fence[2] } } : {}),
        ...(body.length > 0
          ? { content: [{ type: "text", text: body.join("\n") }] }
          : {}),
      });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      out.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: inline(heading[2]),
      });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      out.push({ type: "rule" });
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(QUOTE.exec(lines[i])![1]);
        i += 1;
      }
      i -= 1;
      out.push({ type: "blockquote", content: parseBlocks(quoted) });
      continue;
    }
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR.test(lines[i + 1]) &&
      lines[i + 1].includes("-")
    ) {
      flush();
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      i -= 1;
      out.push(table(rows));
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
      const run: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        (LIST_ITEM.test(lines[i]) || /^\s+\S/.test(lines[i]))
      ) {
        run.push(lines[i]);
        i += 1;
      }
      i -= 1;
      out.push(...parseList(run));
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return out;
}

/**
 * Splits a table row at unescaped pipes. `adfToMarkdown` writes a literal pipe
 * after n backslashes as 2n+1 backslashes plus the pipe, which is undone here.
 */
function splitRow(line: string): string[] {
  const text = line.trim().replace(/^\|/, "");
  const cells: string[] = [];
  let current = "";
  let last = 0;
  for (const match of text.matchAll(/(\\*)\|/g)) {
    current += text.slice(last, match.index);
    last = match.index + match[0].length;
    const slashes = match[1].length;
    if (slashes % 2 === 1) {
      current += `${"\\".repeat((slashes - 1) / 2)}|`;
    } else {
      cells.push(current + match[1]);
      current = "";
    }
  }
  current += text.slice(last);
  if (current.trim() || last < text.length || cells.length === 0) {
    cells.push(current);
  }
  return cells.map((cell) => cell.trim());
}

function table(rows: string[][]): Node {
  const width = Math.max(...rows.map((row) => row.length));
  const cell = (type: string, text: string): Node => ({
    type,
    content: text
      .split(/<br\s*\/?>/i)
      .map((part) => part.trim())
      .map((part) =>
        part
          ? { type: "paragraph", content: inline(part) }
          : { type: "paragraph" },
      ),
  });
  return {
    type: "table",
    content: rows.map((row, index) => ({
      type: "tableRow",
      content: Array.from({ length: width }, (_, column) =>
        cell(index === 0 ? "tableHeader" : "tableCell", row[column] ?? ""),
      ),
    })),
  };
}

/** One list level: items at the shallowest indent; deeper lines nest. */
function parseList(lines: string[]): Node[] {
  const indents = lines.flatMap((line) => {
    const match = LIST_ITEM.exec(line);
    return match ? [match[1].length] : [];
  });
  const base = Math.min(...indents);
  const lists: Node[] = [];
  let current: { ordered: boolean; items: Node[] } | undefined;
  let nested: string[] = [];
  const closeItem = () => {
    if (!current || nested.length === 0) return;
    const item = current.items[current.items.length - 1];
    (item.content as Node[]).push(...parseList(nested));
    nested = [];
  };
  const closeList = () => {
    closeItem();
    if (current) {
      lists.push({
        type: current.ordered ? "orderedList" : "bulletList",
        content: current.items,
      });
    }
    current = undefined;
  };
  for (const line of lines) {
    const match = LIST_ITEM.exec(line);
    if (match && match[1].length <= base) {
      closeItem();
      const ordered = /\d/.test(match[2]);
      if (current && current.ordered !== ordered) closeList();
      current ??= { ordered, items: [] };
      current.items.push({
        type: "listItem",
        content: [{ type: "paragraph", content: inline(match[3]) }],
      });
    } else {
      nested.push(line);
    }
  }
  closeList();
  return lists;
}

/** Paragraph lines joined by hard breaks, which `adfToMarkdown` renders back as line breaks. */
function inlineLines(lines: string[]): Node[] {
  return lines.flatMap((line, index) => [
    ...(index > 0 ? [{ type: "hardBreak" }] : []),
    ...inline(line),
  ]);
}

const INLINE =
  /\\([\\`*_[\]~<>#+\-.)!|])|(`+)(.+?)\2|\[((?:\\.|[^\]\\])+)\]\((\S+?)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(?!\s)(.+?)\*|\b_(?!\s)(.+?)_\b/;

/** CommonMark: one space of padding on both sides of a code span is dropped. */
function codeText(text: string): string {
  return /^ .*\S.* $/s.test(text) ? text.slice(1, -1) : text;
}

function inline(text: string, marks: Node[] = []): Node[] {
  const out: Node[] = [];
  const push = (value: string, extra: Node[] = []) => {
    if (!value) return;
    const all = [...marks, ...extra];
    const previous = out.at(-1);
    if (
      previous &&
      JSON.stringify(previous.marks) ===
        JSON.stringify(all.length ? all : undefined)
    ) {
      previous.text = `${String(previous.text)}${value}`;
      return;
    }
    out.push({
      type: "text",
      text: value,
      ...(all.length > 0 ? { marks: all } : {}),
    });
  };
  let rest = text;
  for (let match = INLINE.exec(rest); match; match = INLINE.exec(rest)) {
    push(rest.slice(0, match.index));
    if (match[1] !== undefined) push(match[1]);
    else if (match[3] !== undefined)
      push(codeText(match[3]), [{ type: "code" }]);
    else if (match[4] !== undefined)
      out.push(
        ...inline(match[4], [
          ...marks,
          { type: "link", attrs: { href: match[5] } },
        ]),
      );
    else {
      const [body, mark] =
        match[6] !== undefined
          ? [match[6], "strong"]
          : match[7] !== undefined
            ? [match[7], "strong"]
            : match[8] !== undefined
              ? [match[8], "strike"]
              : match[9] !== undefined
                ? [match[9], "em"]
                : [match[10], "em"];
      out.push(...inline(body, [...marks, { type: mark }]));
    }
    rest = rest.slice(match.index + match[0].length);
  }
  push(rest);
  return out;
}
