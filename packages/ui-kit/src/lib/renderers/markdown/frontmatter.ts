import { parse } from "yaml";

/** Class that marks the rendered frontmatter table (allowed by the sanitizer). */
export const FRONTMATTER_CLASS = "frontmatter";

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type HastNode =
  | { type: "text"; value: string }
  | {
      type: "element";
      tagName: string;
      properties: Record<string, unknown>;
      children: HastNode[];
    };

type Scalar = string | number | boolean | null;

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** Flat scalar (or scalar-list) values, or undefined when a table cannot show them. */
function tableRows(source: string): [string, string][] | undefined {
  let data: unknown;
  try {
    data = parse(source);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return undefined;
  const rows: [string, string][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (isScalar(value)) rows.push([key, value === null ? "" : String(value)]);
    else if (Array.isArray(value) && value.every(isScalar))
      rows.push([key, value.map((item) => String(item ?? "")).join(", ")]);
    else return undefined;
  }
  return rows.length > 0 ? rows : undefined;
}

function element(
  tagName: string,
  children: HastNode[],
  properties: Record<string, unknown> = {},
): HastNode {
  return { type: "element", tagName, properties, children };
}

function tableNode(rows: [string, string][]): MdastNode {
  const body = rows.map(([key, value]) =>
    element("tr", [
      element("th", [{ type: "text", value: key }], { scope: "row" }),
      element("td", [{ type: "text", value }]),
    ]),
  );
  return {
    type: "frontmatterTable",
    data: {
      hName: "table",
      hProperties: { className: [FRONTMATTER_CLASS] },
      hChildren: [element("tbody", body)],
    },
  };
}

/**
 * Remark transform for `remark-frontmatter` YAML nodes: flat metadata renders
 * as a key/value table, anything else as a highlighted `yaml` code block.
 */
export function remarkFrontmatterTable() {
  return (tree: MdastNode) => {
    const children = tree.children ?? [];
    const index = children.findIndex((node) => node.type === "yaml");
    if (index === -1) return;
    const node = children[index];
    const source = node.value ?? "";
    if (!source.trim()) {
      children.splice(index, 1);
      return;
    }
    const rows = tableRows(source);
    children[index] = rows
      ? { ...tableNode(rows), position: node.position }
      : { type: "code", lang: "yaml", value: source, position: node.position };
  };
}
