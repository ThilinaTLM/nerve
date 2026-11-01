/**
 * Serialize a DOM selection over rendered Markdown back into Markdown, so
 * quoted selections keep lists, emphasis, code, and headings. Works on a
 * minimal node shape so it can be unit tested without a DOM.
 */

export type MarkdownNode = {
  nodeType: number;
  nodeName: string;
  childNodes: ArrayLike<MarkdownNode>;
  parentNode: MarkdownNode | null;
  textContent: string | null;
  getAttribute?(name: string): string | null;
};

export type SelectionClip = {
  /** Selected part of a text node ("" when it lies outside the selection). */
  textOf(node: MarkdownNode): string;
  /** Whether an element overlaps the selection. */
  includes(node: MarkdownNode): boolean;
};

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

const SKIPPED = new Set([
  "BUTTON",
  "SVG",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "TEXTAREA",
  "SELECT",
]);

const BLOCKS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

function tag(node: MarkdownNode): string {
  return node.nodeName.toUpperCase();
}

function attr(node: MarkdownNode, name: string): string | null {
  return node.getAttribute?.(name) ?? null;
}

function children(node: MarkdownNode): MarkdownNode[] {
  return Array.from(node.childNodes);
}

function isElement(node: MarkdownNode): boolean {
  return node.nodeType === ELEMENT_NODE;
}

function isBlock(node: MarkdownNode): boolean {
  return isElement(node) && BLOCKS.has(tag(node));
}

function isSkipped(node: MarkdownNode): boolean {
  if (!isElement(node)) return false;
  if (SKIPPED.has(tag(node))) return true;
  if (attr(node, "aria-hidden") === "true") return true;
  if (attr(node, "data-quote-skip") !== null) return true;
  const className = attr(node, "class") ?? "";
  return /(^|\s)code-copy(\s|$)/.test(className);
}

function hasAncestor(node: MarkdownNode, name: string): MarkdownNode | null {
  for (let current: MarkdownNode | null = node; current;) {
    if (isElement(current) && tag(current) === name) return current;
    current = current.parentNode;
  }
  return null;
}

function collapse(text: string): string {
  return text.replace(/[ \t\r\n\f]+/g, " ");
}

function tidyInline(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

function codeLanguage(pre: MarkdownNode): string {
  const code = children(pre).find((child) => tag(child) === "CODE");
  const className = `${attr(pre, "class") ?? ""} ${code ? (attr(code, "class") ?? "") : ""}`;
  return className.match(/language-([\w-]+)/)?.[1] ?? "";
}

function wrapInline(content: string, marker: string): string {
  const match = content.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match?.[2]) return content;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

/** `- ` for bullets, the rendered ordinal (honoring `start`) for `<ol>`. */
function listMarker(item: MarkdownNode): string {
  const parent = item.parentNode;
  if (!parent || tag(parent) !== "OL") return "- ";
  const start = Number(attr(parent, "start") ?? "1") || 1;
  const siblings = children(parent).filter((child) => tag(child) === "LI");
  return `${start + siblings.indexOf(item)}. `;
}

class Serializer {
  constructor(private readonly clip: SelectionClip) {}

  private rawText(node: MarkdownNode): string {
    if (node.nodeType === TEXT_NODE) return this.clip.textOf(node);
    if (!isElement(node) || isSkipped(node) || !this.clip.includes(node)) {
      return "";
    }
    if (tag(node) === "BR") return "\n";
    return children(node)
      .map((child) => this.rawText(child))
      .join("");
  }

  inline(node: MarkdownNode): string {
    if (node.nodeType === TEXT_NODE) return collapse(this.clip.textOf(node));
    if (!isElement(node) || isSkipped(node) || !this.clip.includes(node)) {
      return "";
    }
    if (isBlock(node)) return this.block(node);
    const inner = () =>
      children(node)
        .map((child) => this.inline(child))
        .join("");
    switch (tag(node)) {
      case "BR":
        return "\n";
      case "STRONG":
      case "B":
        return wrapInline(inner(), "**");
      case "EM":
      case "I":
        return wrapInline(inner(), "*");
      case "DEL":
      case "S":
        return wrapInline(inner(), "~~");
      case "CODE": {
        const text = this.rawText(node);
        if (!text) return "";
        const fence = text.includes("`") ? "``" : "`";
        return `${fence}${text}${fence}`;
      }
      case "A": {
        const text = inner();
        const href = attr(node, "href");
        if (!text.trim() || !href || href.startsWith("#")) return text;
        return text.trim() === href ? href : `[${text}](${href})`;
      }
      case "INPUT":
        if (attr(node, "type") !== "checkbox") return "";
        return attr(node, "checked") !== null ? "[x] " : "[ ] ";
      case "IMG": {
        const alt = attr(node, "alt") ?? "";
        const src = attr(node, "src");
        return src ? `![${alt}](${src})` : alt;
      }
      default:
        return inner();
    }
  }

  /** Render a node's children as Markdown blocks. */
  blocks(node: MarkdownNode): string[] {
    const result: string[] = [];
    let buffer = "";
    const flush = () => {
      const text = tidyInline(buffer);
      if (text) result.push(text);
      buffer = "";
    };
    for (const child of children(node)) {
      if (isBlock(child)) {
        flush();
        if (isSkipped(child) || !this.clip.includes(child)) continue;
        const text = this.block(child);
        if (text.trim()) result.push(text);
      } else {
        buffer += this.inline(child);
      }
    }
    flush();
    return result;
  }

  block(node: MarkdownNode): string {
    const name = tag(node);
    switch (name) {
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const text = tidyInline(this.blocks(node).join(" "));
        return text ? `${"#".repeat(Number(name[1]))} ${text}` : "";
      }
      case "HR":
        return "---";
      case "PRE":
        return this.pre(node);
      case "UL":
      case "OL":
        return this.list(node);
      case "LI":
        return this.listItem(node, listMarker(node));
      case "BLOCKQUOTE": {
        const text = this.blocks(node).join("\n\n");
        return text
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n");
      }
      case "TABLE":
        return this.table(node);
      default:
        return this.blocks(node).join("\n\n");
    }
  }

  pre(node: MarkdownNode): string {
    const code = this.rawText(node).replace(/\n+$/, "");
    if (!code.trim()) return "";
    const fence = code.includes("```") ? "````" : "```";
    return `${fence}${codeLanguage(node)}\n${code}\n${fence}`;
  }

  list(node: MarkdownNode): string {
    const items: string[] = [];
    for (const child of children(node)) {
      if (tag(child) !== "LI") continue;
      if (isSkipped(child) || !this.clip.includes(child)) continue;
      const item = this.listItem(child, listMarker(child));
      if (item) items.push(item);
    }
    return items.join("\n");
  }

  listItem(node: MarkdownNode, marker: string): string {
    const content = this.blocks(node).join("\n");
    if (!content.trim()) return "";
    const pad = " ".repeat(marker.length);
    const [first = "", ...rest] = content.split("\n");
    return [`${marker}${first}`, ...rest.map((line) => indent(line, pad))].join(
      "\n",
    );
  }

  table(node: MarkdownNode): string {
    const rows: string[][] = [];
    let headerRows = 0;
    const visit = (parent: MarkdownNode) => {
      for (const child of children(parent)) {
        const name = tag(child);
        if (name === "THEAD" || name === "TBODY" || name === "TFOOT") {
          visit(child);
        } else if (name === "TR" && this.clip.includes(child)) {
          const cells = children(child)
            .filter((cell) => tag(cell) === "TH" || tag(cell) === "TD")
            .map((cell) =>
              this.clip.includes(cell)
                ? tidyInline(this.blocks(cell).join(" "))
                    .replaceAll("\n", " ")
                    .replaceAll("|", "\\|")
                : "",
            );
          if (cells.some(Boolean)) {
            if (hasAncestor(child, "THEAD") && rows.length === headerRows) {
              headerRows += 1;
            }
            rows.push(cells);
          }
        }
      }
    };
    visit(node);
    if (rows.length === 0) return "";
    const width = Math.max(...rows.map((row) => row.length));
    const line = (row: string[]) =>
      `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
    const lines = rows.map(line);
    const separator = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
    lines.splice(Math.max(headerRows, 1), 0, separator);
    return lines.join("\n");
  }
}

/** Serialize the clipped subtree rooted at `root` to Markdown. */
export function nodeToMarkdown(
  root: MarkdownNode,
  clip: SelectionClip,
): string {
  const serializer = new Serializer(clip);
  const pre = hasAncestor(root, "PRE");
  let text: string;
  if (pre) {
    text = serializer.pre(pre);
  } else if (root.nodeType === TEXT_NODE) {
    text = collapse(clip.textOf(root));
  } else if (isBlock(root)) {
    text = serializer.block(root);
  } else {
    text = serializer.blocks(root).join("\n\n");
  }
  return trimBlankLines(text);
}

/** Drop leading/trailing blank lines and trailing whitespace on each line. */
export function trimBlankLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n+$/, "");
}

/** Serialize a live DOM selection to Markdown. */
export function selectionToMarkdown(selection: Selection): string {
  const parts: string[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const clip: SelectionClip = {
      textOf(node) {
        const text = node.textContent ?? "";
        const domNode = node as unknown as Node;
        if (!range.intersectsNode(domNode)) return "";
        const start = domNode === range.startContainer ? range.startOffset : 0;
        const end =
          domNode === range.endContainer ? range.endOffset : text.length;
        return text.slice(start, end);
      },
      includes(node) {
        return range.intersectsNode(node as unknown as Node);
      },
    };
    const text = nodeToMarkdown(
      range.commonAncestorContainer as unknown as MarkdownNode,
      clip,
    );
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}
