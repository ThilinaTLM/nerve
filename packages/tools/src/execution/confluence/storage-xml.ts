/**
 * Small, tolerant XML tree for Confluence storage format fragments.
 *
 * Tolerant: no namespace declarations are needed (`ac:`, `ri:` are plain
 * names), HTML entities such as `&nbsp;` are accepted, and the original text,
 * CDATA, comments and attribute strings are kept verbatim so an unmodified
 * tree serializes back to the exact input.
 * Strict: tags must balance, attributes must be quoted and unique, and bare
 * `&` is an error. Errors carry the line and element so an agent can fix them.
 */

export class StorageXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageXmlError";
  }
}

export type XmlElement = {
  kind: "element";
  name: string;
  /** Raw attribute text including the leading space, e.g. ` ac:width="5"`. */
  attrs: string;
  selfClosing: boolean;
  children: XmlNode[];
  line: number;
};
export type XmlText = { kind: "text"; value: string };
/** CDATA sections, comments and processing instructions, kept verbatim. */
export type XmlRaw = { kind: "raw"; value: string };
export type XmlNode = XmlElement | XmlText | XmlRaw;

const BARE_AMPERSAND = /&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/;
const ATTRIBUTE = /\s+([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/y;

export function parseStorage(xml: string): XmlElement {
  const root: XmlElement = {
    kind: "element",
    name: "#root",
    attrs: "",
    selfClosing: false,
    children: [],
    line: 1,
  };
  const stack: XmlElement[] = [root];
  const lineAt = (index: number) => {
    let line = 1;
    for (let i = 0; i < index; i++) if (xml.charCodeAt(i) === 10) line++;
    return line;
  };
  const fail = (message: string, index: number): never => {
    throw new StorageXmlError(`${message} (line ${lineAt(index)})`);
  };
  let i = 0;
  while (i < xml.length) {
    const next = xml.indexOf("<", i);
    const textEnd = next < 0 ? xml.length : next;
    if (textEnd > i) {
      const value = xml.slice(i, textEnd);
      const bare = BARE_AMPERSAND.exec(value);
      if (bare) {
        fail(
          `Bare '&' in text near "${value.slice(Math.max(0, bare.index - 10), bare.index + 12).trim()}"; write &amp;`,
          i + bare.index,
        );
      }
      stack.at(-1)!.children.push({ kind: "text", value });
    }
    if (next < 0) break;
    i = next;
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end < 0) fail("Unterminated comment", i);
      stack
        .at(-1)!
        .children.push({ kind: "raw", value: xml.slice(i, end + 3) });
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i + 9);
      if (end < 0) fail("Unterminated CDATA section", i);
      stack
        .at(-1)!
        .children.push({ kind: "raw", value: xml.slice(i, end + 3) });
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i + 2);
      if (end < 0) fail("Unterminated processing instruction", i);
      stack
        .at(-1)!
        .children.push({ kind: "raw", value: xml.slice(i, end + 2) });
      i = end + 2;
      continue;
    }
    // Find the end of the tag, honoring quoted attribute values.
    let j = i + 1;
    let quote = "";
    for (; j < xml.length; j++) {
      const ch = xml[j];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
    }
    if (j >= xml.length) fail("Unterminated tag", i);
    const inner = xml.slice(i + 1, j);
    const line = lineAt(i);
    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim();
      const open = stack.length > 1 ? stack.pop()! : undefined;
      if (!open) {
        fail(`Unexpected closing tag </${name}> with nothing open`, i);
      } else if (open.name !== name) {
        throw new StorageXmlError(
          `Closing tag </${name}> at line ${line} does not match <${open.name}> opened at line ${open.line}`,
        );
      }
      i = j + 1;
      continue;
    }
    const match = /^([\w:.-]+)([\s\S]*?)(\/?)$/.exec(inner);
    if (!match) fail(`Malformed tag <${inner.slice(0, 30)}`, i);
    const [, name = "", attrs = "", selfClose = ""] = match!;
    validateAttributes(name, attrs, line);
    const element: XmlElement = {
      kind: "element",
      name,
      attrs,
      selfClosing: selfClose === "/",
      children: [],
      line,
    };
    stack.at(-1)!.children.push(element);
    if (!element.selfClosing) stack.push(element);
    i = j + 1;
  }
  if (stack.length > 1) {
    const open = stack.at(-1)!;
    throw new StorageXmlError(
      `<${open.name}> opened at line ${open.line} is never closed`,
    );
  }
  return root;
}

function validateAttributes(name: string, raw: string, line: number): void {
  const seen = new Set<string>();
  ATTRIBUTE.lastIndex = 0;
  let consumed = 0;
  while (consumed < raw.length) {
    ATTRIBUTE.lastIndex = consumed;
    const match = ATTRIBUTE.exec(raw);
    if (!match) {
      if (raw.slice(consumed).trim() === "") return;
      throw new StorageXmlError(
        `Malformed attribute on <${name}> at line ${line}: ${raw.slice(consumed).trim().slice(0, 40)} (values must be quoted)`,
      );
    }
    const attribute = match[1];
    if (seen.has(attribute)) {
      throw new StorageXmlError(
        `Duplicate attribute ${attribute} on <${name}> at line ${line}`,
      );
    }
    seen.add(attribute);
    const value = match[2].slice(1, -1);
    if (value.includes("<") || BARE_AMPERSAND.test(value)) {
      throw new StorageXmlError(
        `Attribute ${attribute} on <${name}> at line ${line} contains an unescaped '<' or '&'`,
      );
    }
    consumed = ATTRIBUTE.lastIndex;
  }
}

/** Throws a `StorageXmlError` with line/element detail when the fragment is malformed. */
export function assertWellFormedStorage(xml: string): void {
  parseStorage(xml);
}

export function serializeNode(node: XmlNode): string {
  if (node.kind === "text" || node.kind === "raw") return node.value;
  if (node.name === "#root") return node.children.map(serializeNode).join("");
  if (node.selfClosing && node.children.length === 0) {
    return `<${node.name}${node.attrs}/>`;
  }
  return `<${node.name}${node.attrs}>${node.children.map(serializeNode).join("")}</${node.name}>`;
}

export function getAttr(element: XmlElement, name: string): string | undefined {
  const match = new RegExp(
    `\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
  ).exec(element.attrs);
  return match ? (match[1] ?? match[2]) : undefined;
}

export function setAttr(
  element: XmlElement,
  name: string,
  value: string,
): void {
  const pattern = new RegExp(
    `\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`,
  );
  const replacement = ` ${name}="${value}"`;
  element.attrs = pattern.test(element.attrs)
    ? element.attrs.replace(pattern, replacement)
    : element.attrs + replacement;
}

export function removeAttr(element: XmlElement, name: string): void {
  element.attrs = element.attrs.replace(
    new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`),
    "",
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body.startsWith("#x"))
        return String.fromCodePoint(parseInt(body.slice(2), 16));
      if (body.startsWith("#"))
        return String.fromCodePoint(parseInt(body.slice(1), 10));
      return ENTITIES[body] ?? match;
    },
  );
}

/** Visible text of a subtree (CDATA and comments excluded), entities decoded. */
export function textOf(node: XmlNode): string {
  if (node.kind === "text") return decodeEntities(node.value);
  if (node.kind === "raw") return "";
  return node.children.map(textOf).join("");
}

export function childElements(element: XmlElement): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement => child.kind === "element",
  );
}

/** Depth-first walk with ancestors (nearest last). Return `false` to skip a subtree. */
export function walk(
  element: XmlElement,
  visit: (element: XmlElement, ancestors: XmlElement[]) => boolean | void,
  ancestors: XmlElement[] = [],
): void {
  for (const child of element.children) {
    if (child.kind !== "element") continue;
    if (visit(child, [...ancestors, element]) === false) continue;
    walk(child, visit, [...ancestors, element]);
  }
}
