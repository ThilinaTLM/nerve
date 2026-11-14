import {
  childElements,
  decodeEntities,
  getAttr,
  parseStorage,
  removeAttr,
  serializeNode,
  setAttr,
  textOf,
  walk,
  type XmlElement,
  type XmlNode,
} from "./storage-xml.js";
import { lintAttachmentRefs, lintTaskIds } from "./page-lint-refs.js";

/**
 * Page linter for Confluence storage XHTML: pure (string in, string out plus
 * messages). Safe issues are fixed; the rest are reported as warnings.
 * Malformed XML throws `StorageXmlError` so the write can be rejected before
 * any HTTP.
 */

/**
 * Content widths in px for the table/page layouts. `default` (760, the fixed-width
 * page column) is verified live on Confluence Cloud; `wide` (960) and `full-width`
 * (1800) are assumed Cloud defaults and not yet verified.
 */
export const CONTENT_WIDTH = {
  default: 760,
  wide: 960,
  "full-width": 1800,
} as const;

/** Layout-cell shares by `ac:layout-section` type, left to right. */
const LAYOUT_SHARES: Record<string, number[]> = {
  two_equal: [0.5, 0.5],
  two_left_sidebar: [0.3, 0.7],
  two_right_sidebar: [0.7, 0.3],
  three_equal: [1 / 3, 1 / 3, 1 / 3],
  three_with_sidebars: [0.2, 0.6, 0.2],
};

const TOC_MIN_SECTIONS = 6;
const TOC_MIN_WORDS = 600;
/** Absolute floor for any column. */
const MIN_COLUMN_PX = 56;

/**
 * Heuristic widths (px) for a 15px body font, calibrated on a live Cloud case
 * where "SCRUM-2" wrapped in a 90px column: capitals 12, other characters 8.5,
 * punctuation 6, plus 20 for cell padding; status lozenge text is uppercase at
 * ~7px per character plus 16px chrome. Estimates are deliberately rough.
 */
const CHAR_PX = { upper: 12, other: 8.5, punctuation: 6 } as const;
const CELL_PADDING_PX = 20;
const LOZENGE_CHAR_PX = 7;
const LOZENGE_CHROME_PX = 16;
const PANEL_MACROS = new Set(["info", "note", "warning", "tip", "panel"]);

export type ImageSize = { width: number; height: number };

export type PageLintOptions = {
  /** Page title (a leading H1 equal to it is removed). */
  title: string;
  /** Set to false to opt out of TOC insertion. */
  toc?: boolean;
  /** Original sizes of attachments by filename (from upload). */
  images?: ReadonlyMap<string, ImageSize> | Record<string, ImageSize>;
  /** Filenames attached to the page (existing and uploaded); referencing any other file warns. */
  attachments?: ReadonlySet<string>;
};

export type PageLintResult = {
  storage: string;
  fixes: string[];
  warnings: string[];
};

export function lintStoragePage(
  storage: string,
  options: PageLintOptions,
): PageLintResult {
  const root = parseStorage(storage);
  const fixes: string[] = [];
  const warnings: string[] = [];
  lintLooseInline(root, fixes);
  lintHeadings(root, options.title, fixes, warnings);
  lintToc(root, options.toc !== false, fixes);
  lintTables(root, fixes, warnings);
  lintBlockMacros(root, fixes);
  lintImages(
    root,
    sizeLookup(options.images),
    options.attachments,
    fixes,
    warnings,
  );
  lintAttachmentRefs(root, options.attachments, warnings);
  lintTaskIds(root, fixes);
  lintRedundancy(root, warnings);
  return { storage: serializeNode(root), fixes, warnings };
}

// ---- helpers ---------------------------------------------------------------

function sizeLookup(
  images: PageLintOptions["images"],
): (filename: string) => ImageSize | undefined {
  if (!images) return () => undefined;
  if (images instanceof Map) return (filename) => images.get(filename);
  return (filename) => (images as Record<string, ImageSize>)[filename];
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function headingLevel(node: XmlNode): number | undefined {
  if (node.kind !== "element") return undefined;
  const match = /^h([1-6])$/.exec(node.name);
  return match ? Number(match[1]) : undefined;
}

function macroName(element: XmlElement): string | undefined {
  return element.name === "ac:structured-macro"
    ? getAttr(element, "ac:name")
    : undefined;
}

function macroParam(element: XmlElement, name: string): string | undefined {
  for (const child of childElements(element)) {
    if (child.name === "ac:parameter" && getAttr(child, "ac:name") === name) {
      return textOf(child).trim();
    }
  }
  return undefined;
}

function isBlank(node: XmlNode): boolean {
  return node.kind === "text" && node.value.trim() === "";
}

function significantChildren(element: XmlElement): XmlNode[] {
  return element.children.filter((child) => !isBlank(child));
}

/** Headings outside macros (panels, expands, ...), in document order. */
function pageHeadings(root: XmlElement): XmlElement[] {
  const headings: XmlElement[] = [];
  walk(root, (element) => {
    if (element.name === "ac:structured-macro") return false;
    if (headingLevel(element) !== undefined) headings.push(element);
    return undefined;
  });
  return headings;
}

function renameHeading(element: XmlElement, level: number): void {
  element.name = `h${level}`;
}

// ---- headings --------------------------------------------------------------

function promoteToH1(root: XmlElement, fixes: string[]): void {
  const headings = pageHeadings(root);
  if (headings.length === 0) return;
  const top = Math.min(...headings.map((h) => headingLevel(h)!));
  if (top <= 1) return;
  const shift = top - 1;
  for (const heading of headings)
    renameHeading(heading, headingLevel(heading)! - shift);
  fixes.push(
    `Promoted all headings by ${shift} level${shift === 1 ? "" : "s"} so sections start at H1 (the page title is a separate field).`,
  );
}

function lintHeadings(
  root: XmlElement,
  title: string,
  fixes: string[],
  warnings: string[],
): void {
  promoteToH1(root, fixes);
  // A leading heading equal to the page title duplicates it.
  const first = significantChildren(root)[0];
  if (
    first &&
    first.kind === "element" &&
    headingLevel(first) === 1 &&
    normalize(textOf(first)) === normalize(title)
  ) {
    root.children.splice(root.children.indexOf(first), 1);
    fixes.push(
      `Removed the leading H1 "${textOf(first).trim()}" that repeats the page title.`,
    );
    promoteToH1(root, fixes);
  }
  let previous = 0;
  for (const heading of pageHeadings(root)) {
    const level = headingLevel(heading)!;
    if (previous > 0 && level > previous + 1) {
      warnings.push(
        `Heading "${textOf(heading).trim()}" jumps from H${previous} to H${level}; do not skip levels.`,
      );
    }
    previous = level;
  }
}

// ---- toc -------------------------------------------------------------------

function hasMacro(root: XmlElement, name: string): boolean {
  let found = false;
  walk(root, (element) => {
    if (macroName(element) === name) found = true;
    return undefined;
  });
  return found;
}

function wordCount(root: XmlElement): number {
  return textOf(root).split(/\s+/).filter(Boolean).length;
}

function lintToc(root: XmlElement, enabled: boolean, fixes: string[]): void {
  if (!enabled || hasMacro(root, "toc")) return;
  const sections = pageHeadings(root).filter(
    (h) => headingLevel(h) === 1,
  ).length;
  const words = wordCount(root);
  if (sections < TOC_MIN_SECTIONS && words < TOC_MIN_WORDS) return;
  const toc: XmlElement = {
    kind: "element",
    name: "ac:structured-macro",
    attrs: ' ac:name="toc" ac:schema-version="1"',
    selfClosing: false,
    line: 0,
    children: [
      {
        kind: "element",
        name: "ac:parameter",
        attrs: ' ac:name="maxLevel"',
        selfClosing: false,
        line: 0,
        children: [{ kind: "text", value: "2" }],
      },
    ],
  };
  const first = significantChildren(root)[0];
  const leadingPanel =
    first &&
    first.kind === "element" &&
    PANEL_MACROS.has(macroName(first) ?? "")
      ? first
      : undefined;
  const index = leadingPanel ? root.children.indexOf(leadingPanel) + 1 : 0;
  root.children.splice(index, 0, toc);
  fixes.push(
    `Inserted a table of contents (${sections} sections, ~${words} words)${leadingPanel ? " after the leading panel" : " at the top"}; pass toc: false to opt out.`,
  );
}

// ---- layout / widths -------------------------------------------------------

/** Width in px available to the element given its ancestors (layout cells narrow it). */
function availableWidth(ancestors: XmlElement[], base: number): number {
  let width = base;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const cell = ancestors[i];
    if (cell.name !== "ac:layout-cell") continue;
    const section = ancestors[i - 1];
    if (section?.name !== "ac:layout-section") break;
    const shares = LAYOUT_SHARES[getAttr(section, "ac:type") ?? ""];
    const index = childElements(section)
      .filter((c) => c.name === "ac:layout-cell")
      .indexOf(cell);
    const share = shares?.[index];
    if (share) width = Math.round(base * share);
    break;
  }
  return width;
}

// ---- tables ----------------------------------------------------------------

function tableRows(table: XmlElement): XmlElement[] {
  const rows: XmlElement[] = [];
  for (const child of childElements(table)) {
    if (child.name === "tr") rows.push(child);
    else if (child.name === "tbody" || child.name === "thead") {
      rows.push(...childElements(child).filter((c) => c.name === "tr"));
    }
  }
  return rows;
}

const SHORT_MACROS = new Set(["status", "jira"]);

/** Approximate visible length of a cell; lozenges, dates, keys and mentions count as short. */
function cellLength(node: XmlNode): number {
  if (node.kind === "text")
    return decodeEntities(node.value).replace(/\s+/g, " ").length;
  if (node.kind === "raw") return 0;
  if (
    node.name === "ac:structured-macro" &&
    SHORT_MACROS.has(macroName(node) ?? "")
  )
    return 10;
  if (node.name === "time") return 10;
  if (node.name === "ri:user" || node.name === "ac:link") return 14;
  if (node.name === "ac:parameter" || node.name === "ac:structured-macro")
    return 0;
  return node.children.reduce((sum, child) => sum + cellLength(child), 0);
}

function textTokenPx(token: string): number {
  let px = 0;
  for (const ch of token) {
    px += /[A-Z]/.test(ch)
      ? CHAR_PX.upper
      : /[\w]/.test(ch) || ch.charCodeAt(0) > 127
        ? CHAR_PX.other
        : CHAR_PX.punctuation;
  }
  return px;
}

type Unbreakable = { px: number; token: string };

/** Widest piece of a cell that cannot wrap (whitespace-delimited word, lozenge, key, date, mention). */
function longestUnbreakable(node: XmlNode): Unbreakable {
  let best: Unbreakable = { px: 0, token: "" };
  const consider = (px: number, token: string) => {
    if (px > best.px) best = { px, token };
  };
  const visit = (current: XmlNode) => {
    if (current.kind === "text") {
      for (const token of decodeEntities(current.value).split(/\s+/)) {
        if (token) consider(textTokenPx(token), token);
      }
      return;
    }
    if (current.kind === "raw") return;
    const macro = macroName(current);
    if (macro === "status") {
      const title = macroParam(current, "title") ?? "";
      consider(
        title.length * LOZENGE_CHAR_PX + LOZENGE_CHROME_PX,
        title.toUpperCase(),
      );
      return;
    }
    if (macro === "jira") {
      const key = macroParam(current, "key");
      if (key) consider(textTokenPx(key) + 24, key);
      return;
    }
    if (current.name === "time") {
      consider(90, getAttr(current, "datetime") ?? "date");
      return;
    }
    if (current.name === "ri:user" || current.name === "ac:link") {
      consider(110, "@mention");
      return;
    }
    if (
      current.name === "ac:parameter" ||
      current.name === "ac:structured-macro"
    )
      return;
    current.children.forEach(visit);
  };
  visit(node);
  return best;
}

/** Per-column minimum width and the token that needs it, over header and body cells. */
function columnMinimums(rows: XmlElement[]): Unbreakable[] {
  const minimums: Unbreakable[] = [];
  for (const row of rows) {
    let position = 0;
    for (const cell of childElements(row)) {
      if (cell.name !== "th" && cell.name !== "td") continue;
      const span = Number(getAttr(cell, "colspan") ?? 1) || 1;
      if (span === 1) {
        const found = longestUnbreakable(cell);
        const need = {
          px: Math.ceil(found.px + CELL_PADDING_PX),
          token: found.token,
        };
        if (!minimums[position] || need.px > minimums[position].px)
          minimums[position] = need;
      }
      position += span;
    }
  }
  return minimums;
}

function columnWidths(
  rows: XmlElement[],
  total: number,
  minimums: Unbreakable[],
): number[] | undefined {
  const lengths: number[][] = [];
  let columns = 0;
  rows.forEach((row) => {
    let position = 0;
    for (const cell of childElements(row)) {
      if (cell.name !== "th" && cell.name !== "td") continue;
      const span = Number(getAttr(cell, "colspan") ?? 1) || 1;
      if (span === 1) (lengths[position] ??= []).push(cellLength(cell));
      position += span;
    }
    columns = Math.max(columns, position);
  });
  if (columns === 0) return undefined;
  const scores = Array.from({ length: columns }, (_, column) => {
    const values = lengths[column] ?? [4];
    const header = values[0];
    const body = values.slice(1);
    const average = body.length
      ? body.reduce((a, b) => a + b, 0) / body.length
      : header;
    const longest = body.length ? Math.max(...body) : header;
    const score = Math.max(
      header,
      0.6 * average + 0.4 * Math.min(longest, 3 * Math.max(average, 1)),
    );
    return Math.min(80, Math.max(6, score));
  });
  const floors = scores.map((_, column) =>
    Math.max(MIN_COLUMN_PX, minimums[column]?.px ?? 0),
  );
  // Proportional shares, then pin columns at their floor and re-share the rest until stable.
  const widths = scores.map(() => 0);
  const pinned = new Set<number>();
  for (let round = 0; round <= scores.length; round++) {
    const free = scores.map((_, i) => i).filter((i) => !pinned.has(i));
    const remaining =
      total - [...pinned].reduce((sum, i) => sum + floors[i], 0);
    const weight = free.reduce((sum, i) => sum + scores[i], 0);
    let changed = false;
    for (const i of free) {
      widths[i] = (Math.max(0, remaining) * scores[i]) / weight;
      if (widths[i] < floors[i]) {
        pinned.add(i);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const i of pinned) widths[i] = floors[i]!;
  const rounded = widths.map((w) => Math.round(w));
  const drift = total - rounded.reduce((a, b) => a + b, 0);
  const widest = rounded.indexOf(Math.max(...rounded));
  rounded[widest] = rounded[widest] + drift;
  return rounded;
}

function warnExplicitWidths(
  table: XmlElement,
  colgroup: XmlElement,
  warnings: string[],
): void {
  const rows = tableRows(table);
  const minimums = columnMinimums(rows);
  const headers = childElements(rows[0] ?? table).filter(
    (c) => c.name === "th" || c.name === "td",
  );
  childElements(colgroup)
    .filter((col) => col.name === "col")
    .forEach((col, index) => {
      const width = Number(
        /width\s*:\s*([\d.]+)/.exec(getAttr(col, "style") ?? "")?.[1] ??
          getAttr(col, "width"),
      );
      const need = minimums[index];
      if (!Number.isFinite(width) || !need || need.px <= width) return;
      const title = headers[index] ? textOf(headers[index]).trim() : "";
      warnings.push(
        `Column ${title ? `"${title}"` : index + 1} is ${Math.round(width)}px; "${need.token}" needs about ${Math.ceil(need.px / 5) * 5}px and will wrap.`,
      );
    });
}

function colHasWidth(col: XmlElement): boolean {
  return (
    /width\s*:/.test(getAttr(col, "style") ?? "") ||
    getAttr(col, "width") !== undefined
  );
}

function lintTables(
  root: XmlElement,
  fixes: string[],
  warnings: string[],
): void {
  walk(root, (element, ancestors) => {
    if (element.name !== "table") return undefined;
    const existing = childElements(element).find(
      (child) => child.name === "colgroup",
    );
    // Never override explicit widths; only warn where a column is too narrow for its longest unbreakable token.
    if (existing && childElements(existing).some(colHasWidth)) {
      warnExplicitWidths(element, existing, warnings);
      return undefined;
    }
    const layout = (getAttr(element, "data-layout") ??
      "default") as keyof typeof CONTENT_WIDTH;
    const base = CONTENT_WIDTH[layout] ?? CONTENT_WIDTH.default;
    const total = availableWidth(ancestors, base);
    const rows = tableRows(element);
    const widths = columnWidths(rows, total, columnMinimums(rows));
    if (!widths) return undefined;
    const colgroup: XmlElement = {
      kind: "element",
      name: "colgroup",
      attrs: "",
      selfClosing: false,
      line: 0,
      children: widths.map((width) => ({
        kind: "element" as const,
        name: "col",
        attrs: ` style="width: ${width}px;"`,
        selfClosing: true,
        children: [],
        line: 0,
      })),
    };
    if (existing)
      element.children[element.children.indexOf(existing)] = colgroup;
    else element.children.unshift(colgroup);
    if (getAttr(element, "data-layout") === undefined)
      setAttr(element, "data-layout", "default");
    fixes.push(
      `Set column widths on a ${widths.length}-column table (${widths.join(", ")} px).`,
    );
    return undefined;
  });
}

// ---- images ----------------------------------------------------------------

/** Scaling below this share of the original width makes diagram text hard to read. */
const MIN_READABLE_SCALE = 0.8;

function warnIfDownscaled(
  warnings: string[],
  label: string,
  original: number | undefined,
  shown: number,
): void {
  if (!original || shown >= original * MIN_READABLE_SCALE) return;
  warnings.push(
    `Image "${label}" is scaled from ${original}px to ${shown}px (${Math.round((shown / original) * 100)}%); its text may be hard to read. Use a narrower image (for diagrams e.g. flowchart TB or fewer nodes per row) whose natural width is close to ${shown}px.`,
  );
}

function lintImages(
  root: XmlElement,
  sizeOf: (filename: string) => ImageSize | undefined,
  attached: ReadonlySet<string> | undefined,
  fixes: string[],
  warnings: string[],
): void {
  walk(root, (element, ancestors) => {
    if (element.name !== "ac:image") return undefined;
    const attachment = childElements(element).find(
      (child) => child.name === "ri:attachment",
    );
    const url = childElements(element).find((child) => child.name === "ri:url");
    const filename = attachment
      ? getAttr(attachment, "ri:filename")
      : undefined;
    const label =
      filename ?? (url ? getAttr(url, "ri:value") : undefined) ?? "image";
    if (filename && /\.(svg|webp)$/i.test(filename)) {
      warnings.push(
        `Image "${filename}" is ${filename.split(".").pop()!.toUpperCase()}; use PNG or JPEG so Confluence renders it reliably.`,
      );
    }
    const available = availableWidth(ancestors, CONTENT_WIDTH.default);
    const given = Number(getAttr(element, "ac:width"));
    if (Number.isFinite(given) && given > 0) {
      if (given > available) {
        setAttr(element, "ac:width", String(available));
        removeAttr(element, "ac:height");
        fixes.push(
          `Clamped image "${label}" from ${given}px to the content width ${available}px.`,
        );
        const original = filename ? sizeOf(filename)?.width : undefined;
        warnIfDownscaled(warnings, label, original, available);
      }
      return undefined;
    }
    const size = filename ? sizeOf(filename) : undefined;
    if (size) {
      const width = Math.min(size.width, available);
      setAttr(element, "ac:width", String(width));
      fixes.push(
        `Set image "${label}" width to ${width}px (original ${size.width}px, content ${available}px).`,
      );
      warnIfDownscaled(warnings, label, size.width, width);
    } else if (!(filename && attached && !attached.has(filename))) {
      // A file missing from the page already gets the "not on the page" warning.
      warnings.push(
        `Image "${label}" has no width and its original size is unknown; set ac:width (max ${available}px).`,
      );
    }
    return undefined;
  });
}

// ---- redundancy ------------------------------------------------------------

function lintRedundancy(root: XmlElement, warnings: string[]): void {
  const containers: XmlElement[] = [root];
  walk(root, (element) => {
    containers.push(element);
    return undefined;
  });
  for (const container of containers) {
    const children = significantChildren(container);
    children.forEach((node, index) => {
      const level = headingLevel(node);
      if (level === undefined || node.kind !== "element") return;
      const text = textOf(node).trim();
      const next = children[index + 1];
      if (
        next?.kind === "element" &&
        PANEL_MACROS.has(macroName(next) ?? "") &&
        normalize(macroParam(next, "title") ?? "") === normalize(text) &&
        text
      ) {
        warnings.push(
          `Heading "${text}" is immediately followed by a panel with the same title; drop one.`,
        );
      }
      // Section content runs to the next heading in this container.
      const rest: XmlNode[] = [];
      for (const sibling of children.slice(index + 1)) {
        if (headingLevel(sibling) !== undefined) break;
        rest.push(sibling);
      }
      const nextHeading = children
        .slice(index + 1)
        .find((s) => headingLevel(s) !== undefined);
      if (
        rest.length === 0 &&
        (!nextHeading || headingLevel(nextHeading)! <= level)
      ) {
        warnings.push(`Section "${text}" is empty.`);
      }
      let only = rest.length === 1 ? rest[0] : undefined;
      // A lone inline macro is usually wrapped in its own paragraph.
      if (only?.kind === "element" && only.name === "p") {
        const inner = significantChildren(only);
        only = inner.length === 1 ? inner[0] : undefined;
      }
      if (only?.kind === "element" && macroName(only) === "jira") {
        const key = macroParam(only, "key");
        if (key && normalize(key) === normalize(text)) {
          warnings.push(
            `Heading "${text}" only repeats the key of the single Jira macro below it; drop the heading or add context.`,
          );
        }
      }
    });
  }
}

// ---- loose inline content --------------------------------------------------

/** Containers whose children must be blocks (td/th/li accept inline content directly). */
const BLOCK_CONTAINERS = new Set([
  "#root",
  "ac:rich-text-body",
  "ac:layout-cell",
  "blockquote",
]);
const INLINE_ELEMENTS = new Set([
  "a",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "del",
  "sub",
  "sup",
  "code",
  "span",
  "br",
  "time",
  "ac:link",
  "ac:emoticon",
  "ac:inline-comment-marker",
]);
const INLINE_MACROS = new Set(["status"]);

function isInlineNode(node: XmlNode): boolean {
  if (node.kind === "text") return node.value.trim() !== "";
  if (node.kind === "raw") return false;
  if (INLINE_ELEMENTS.has(node.name)) return true;
  const name = macroName(node);
  // A Jira macro with a key is inline; a JQL list is a block.
  return (
    name !== undefined &&
    (INLINE_MACROS.has(name) ||
      (name === "jira" && macroParam(node, "key") !== undefined))
  );
}

function paragraph(children: XmlNode[]): XmlElement {
  return {
    kind: "element",
    name: "p",
    attrs: "",
    selfClosing: false,
    children,
    line: 0,
  };
}

function lintLooseInline(root: XmlElement, fixes: string[]): void {
  let wrapped = 0;
  const visit = (container: XmlElement) => {
    if (BLOCK_CONTAINERS.has(container.name)) {
      const result: XmlNode[] = [];
      let run: XmlNode[] = [];
      const flush = () => {
        // Trailing whitespace stays outside the paragraph.
        const trailing: XmlNode[] = [];
        while (run.length > 0 && !isInlineNode(run.at(-1)!))
          trailing.unshift(run.pop()!);
        if (run.length > 0) {
          result.push(paragraph(run));
          wrapped++;
        }
        result.push(...trailing);
        run = [];
      };
      for (const child of container.children) {
        if (isInlineNode(child)) run.push(child);
        else if (
          run.length > 0 &&
          child.kind === "text" &&
          child.value.trim() === ""
        )
          run.push(child);
        else {
          flush();
          result.push(child);
        }
      }
      flush();
      container.children = result;
    }
    for (const child of container.children)
      if (child.kind === "element") visit(child);
  };
  visit(root);
  if (wrapped > 0) {
    fixes.push(
      `Wrapped ${wrapped} run${wrapped === 1 ? "" : "s"} of loose inline content (text, dates, links, lozenges) in <p>; keep inline items inside storage.p(...) so they stay on one line.`,
    );
  }
}

// ---- block macros ----------------------------------------------------------

/**
 * Cloud renders the Jira issue list macro full-width (1761 px in a 760 px column)
 * unless the macro element carries data-layout; "default" keeps it in the column
 * (verified live: Cloud honors data-layout on the macro element).
 */
function lintBlockMacros(root: XmlElement, fixes: string[]): void {
  let count = 0;
  walk(root, (element) => {
    if (
      macroName(element) !== "jira" ||
      getAttr(element, "data-layout") !== undefined
    )
      return undefined;
    const isList = ["jqlQuery", "jql", "url"].some(
      (name) => macroParam(element, name) !== undefined,
    );
    if (!isList) return undefined;
    setAttr(element, "data-layout", "default");
    count++;
    return undefined;
  });
  if (count > 0) {
    fixes.push(
      `Set data-layout="default" on ${count} Jira issue list macro${count === 1 ? "" : "s"} so they stay within the content width.`,
    );
  }
}
