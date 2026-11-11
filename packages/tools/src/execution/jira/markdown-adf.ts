import type { AdfDocument } from "./adf.js";

type Node = Record<string, unknown>;

/**
 * Markdown → ADF for Jira descriptions and comments: headings, paragraphs,
 * (nested) bullet and numbered lists, fenced code, block quotes, rules and the
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
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
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
  /(`+)(.+?)\1|\[([^\]]+)\]\((\S+?)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(?!\s)(.+?)\*|\b_(?!\s)(.+?)_\b/;

function inline(text: string, marks: Node[] = []): Node[] {
  const out: Node[] = [];
  const push = (value: string, extra: Node[] = []) => {
    if (!value) return;
    const all = [...marks, ...extra];
    out.push({
      type: "text",
      text: value,
      ...(all.length > 0 ? { marks: all } : {}),
    });
  };
  let rest = text;
  for (let match = INLINE.exec(rest); match; match = INLINE.exec(rest)) {
    push(rest.slice(0, match.index));
    if (match[2] !== undefined) push(match[2], [{ type: "code" }]);
    else if (match[3] !== undefined)
      out.push(
        ...inline(match[3], [
          ...marks,
          { type: "link", attrs: { href: match[4] } },
        ]),
      );
    else {
      const [body, mark] =
        match[5] !== undefined
          ? [match[5], "strong"]
          : match[6] !== undefined
            ? [match[6], "strong"]
            : match[7] !== undefined
              ? [match[7], "strike"]
              : match[8] !== undefined
                ? [match[8], "em"]
                : [match[9], "em"];
      out.push(...inline(body, [...marks, { type: mark }]));
    }
    rest = rest.slice(match.index + match[0].length);
  }
  push(rest);
  return out;
}
