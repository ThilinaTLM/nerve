type Node = {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: unknown; attrs?: Record<string, unknown> }>;
  content?: unknown;
};

/**
 * Total ADF → Markdown converter: never throws, unknown nodes fall back to
 * their text content. Complete (no truncation); meant for agent consumption.
 */
export function adfToMarkdown(doc: unknown): string {
  if (typeof doc === "string") return doc;
  if (!isNode(doc)) return "";
  return blocks(children(doc), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function children(node: Node): Node[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : [];
}

/** Renders block nodes separated by blank lines, each line prefixed. */
function blocks(nodes: Node[], prefix: string): string {
  const rendered = nodes
    .map((node) => block(node))
    .filter((text) => text.length > 0);
  return rendered
    .join("\n\n")
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join("\n");
}

function block(node: Node): string {
  const kids = children(node);
  switch (node.type) {
    case "doc":
      return blocks(kids, "");
    case "paragraph":
      return inline(kids);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return `${"#".repeat(level)} ${inline(kids)}`;
    }
    case "bulletList":
    case "orderedList":
      return list(node);
    case "codeBlock": {
      const language =
        typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const text = kids.map(plainText).join("");
      const fence = text.includes("```") ? "````" : "```";
      return `${fence}${language}\n${text}\n${fence}`;
    }
    case "blockquote":
      return blocks(kids, "> ");
    case "panel":
      return blocks(kids, "> ");
    case "rule":
      return "---";
    case "table":
      return table(kids);
    case "mediaSingle":
    case "mediaGroup":
      return kids.map(block).filter(Boolean).join("\n");
    case "media": {
      const name = node.attrs?.alt ?? node.attrs?.id;
      return typeof name === "string" ? `[attachment: ${name}]` : "";
    }
    case "expand":
    case "nestedExpand": {
      const title = node.attrs?.title;
      const body = blocks(kids, "");
      return typeof title === "string" && title
        ? `**${title}**\n\n${body}`
        : body;
    }
    default:
      // Unknown containers: keep whatever text they hold.
      return isInlineType(node.type) ? inline([node]) : fallback(node);
  }
}

function fallback(node: Node): string {
  const kids = children(node);
  if (kids.length === 0) return typeof node.text === "string" ? node.text : "";
  return kids.every((kid) => isInlineType(kid.type))
    ? inline(kids)
    : blocks(kids, "");
}

function isInlineType(type: unknown): boolean {
  return (
    type === "text" ||
    type === "hardBreak" ||
    type === "mention" ||
    type === "emoji" ||
    type === "inlineCard" ||
    type === "status" ||
    type === "date" ||
    type === "mediaInline"
  );
}

function list(node: Node): string {
  const ordered = node.type === "orderedList";
  const start = Number(node.attrs?.order) || 1;
  return children(node)
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : "- ";
      const indent = " ".repeat(marker.length);
      const body = blocks(children(item), "")
        .split("\n")
        // Nested lists follow directly under their parent paragraph.
        .map((line, lineIndex) =>
          lineIndex === 0 ? marker + line : line ? indent + line : line,
        )
        .join("\n");
      return body.replace(/\n\n(\s*(?:- |\d+\. ))/g, "\n$1");
    })
    .join("\n");
}

function table(rows: Node[]): string {
  const cells = rows
    .filter((row) => row.type === "tableRow")
    .map((row) =>
      children(row).map((cell) =>
        blocks(children(cell), "")
          .replace(/\|/g, "\\|")
          .replace(/\n+/g, "<br>"),
      ),
    );
  if (cells.length === 0) return "";
  const width = Math.max(...cells.map((row) => row.length));
  const pad = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
  const [header, ...body] = cells as [string[], ...string[][]];
  return [
    pad(header),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map(pad),
  ].join("\n");
}

function inline(nodes: Node[]): string {
  return nodes.map(inlineNode).join("");
}

function inlineNode(node: Node): string {
  switch (node.type) {
    case "text":
      return applyMarks(
        typeof node.text === "string" ? node.text : "",
        node.marks,
      );
    case "hardBreak":
      return "  \n";
    case "mention": {
      const text = node.attrs?.text;
      return typeof text === "string" && text
        ? text
        : `@${String(node.attrs?.id ?? "unknown")}`;
    }
    case "emoji":
      return String(node.attrs?.text ?? node.attrs?.shortName ?? "");
    case "inlineCard": {
      const url = node.attrs?.url;
      return typeof url === "string" ? `<${url}>` : "";
    }
    case "status":
      return `[${String(node.attrs?.text ?? "")}]`;
    case "date": {
      const ts = Number(node.attrs?.timestamp);
      return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : "";
    }
    default:
      return fallback(node);
  }
}

function applyMarks(text: string, marks: Node["marks"]): string {
  if (!marks || marks.length === 0 || text.length === 0) return text;
  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "code":
        out = `\`${out}\``;
        break;
      case "strong":
        out = wrap(out, "**");
        break;
      case "em":
        out = wrap(out, "*");
        break;
      case "strike":
        out = wrap(out, "~~");
        break;
      case "link": {
        const href = mark.attrs?.href;
        if (typeof href === "string") out = `[${out}](${href})`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Keeps surrounding whitespace outside the emphasis markers. */
function wrap(text: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!match || !match[2]) return text;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

function plainText(node: Node): string {
  if (typeof node.text === "string") return node.text;
  if (node.type === "hardBreak") return "\n";
  return children(node).map(plainText).join("");
}
