import { foldable, foldedRanges } from "@codemirror/language";
import type { SearchQuery } from "@codemirror/search";
import {
  countColumn,
  type EditorState,
  findColumn,
  type Text,
} from "@codemirror/state";
export { contextSelection } from "./codemirror-context-menu";

export type SearchMatchStatus = {
  count: number;
  current?: number;
  capped: boolean;
};

export function copySelectedText(
  state: EditorState,
  copy: (text: string) => void,
): boolean {
  const range = state.selection.main;
  if (range.empty) return false;
  copy(state.sliceDoc(range.from, range.to));
  return true;
}

export function selectedSearchText(
  state: EditorState,
  position?: number,
): string | undefined {
  const range = state.selection.main;
  if (range.empty) return undefined;
  if (position !== undefined && (position < range.from || position > range.to))
    return undefined;
  return state.sliceDoc(range.from, range.to);
}

export function isSearchQueryValid(query: SearchQuery): boolean {
  return !query.search || query.valid;
}

export function searchMatchStatus(
  state: EditorState,
  query: SearchQuery,
  limit = 10_000,
): SearchMatchStatus {
  if (!query.valid || !query.search) return { count: 0, capped: false };
  const selected = state.selection.main;
  let count = 0;
  let current: number | undefined;
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    const match = next.value;
    count += 1;
    if (match.from === selected.from && match.to === selected.to)
      current = count;
    if (count >= limit) return { count, current, capped: true };
  }
  return { count, current, capped: false };
}

export function canFoldAt(state: EditorState, position: number): boolean {
  const line = state.doc.lineAt(position);
  return Boolean(foldable(state, line.from, line.to));
}

export function canUnfoldAt(state: EditorState, position: number): boolean {
  const line = state.doc.lineAt(position);
  let found = false;
  foldedRanges(state).between(line.from, line.to, () => {
    found = true;
  });
  return found;
}

export function viewerShortcut(
  key: string,
  options: { shift?: boolean; alt?: boolean } = {},
): string {
  const mac =
    typeof navigator !== "undefined" &&
    (navigator.platform.toLowerCase().includes("mac") ||
      navigator.userAgent.includes("Mac OS X"));
  if (mac) {
    return `${options.alt ? "⌥" : ""}${options.shift ? "⇧" : ""}⌘${key.toUpperCase()}`;
  }
  return `Ctrl+${options.alt ? "Alt+" : ""}${options.shift ? "Shift+" : ""}${key.toUpperCase()}`;
}

/** The smallest single replacement turning `current` into `next`, so an
 * external refresh keeps the selection, scroll position and folds outside the
 * changed region. Returns undefined when the documents are equal. */
export function minimalDocumentChange(
  current: Text,
  next: Text,
): { from: number; to: number; insert: Text } | undefined {
  if (current.eq(next)) return undefined;
  const a = current.toString();
  const b = next.toString();
  const shorter = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < shorter && a.charCodeAt(prefix) === b.charCodeAt(prefix))
    prefix += 1;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  )
    suffix += 1;
  return {
    from: prefix,
    to: a.length - suffix,
    insert: next.slice(prefix, b.length - suffix),
  };
}

export type GoToLineTarget = { line: number; column?: number };

/** Parses `line`, `line:column` or `line,column` (1-based, in the numbers the
 * gutter shows). */
export function parseGoToLine(input: string): GoToLineTarget | undefined {
  const match = /^\s*(\d+)\s*(?:[:,]\s*(\d+)\s*)?$/.exec(input);
  if (!match) return undefined;
  const line = Number(match[1]);
  const column = match[2] === undefined ? undefined : Number(match[2]);
  if (!Number.isSafeInteger(line) || line < 1) return undefined;
  if (column !== undefined && (!Number.isSafeInteger(column) || column < 1))
    return undefined;
  return { line, column };
}

/** Document offset for a go-to-line target, clamped to the document. */
export function goToLinePosition(
  state: EditorState,
  target: GoToLineTarget,
  lineStart = 1,
): number {
  const local = Math.min(
    Math.max(target.line - lineStart + 1, 1),
    state.doc.lines,
  );
  const line = state.doc.line(local);
  const column = Math.max((target.column ?? 1) - 1, 0);
  return line.from + findColumn(line.text, column, state.tabSize);
}

export type CursorStatus = {
  line: number;
  column: number;
  selections: number;
  selectedLength: number;
};

/** Cursor line/column (tabs expanded to the tab size) and selection totals. */
export function cursorStatus(state: EditorState, lineStart = 1): CursorStatus {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  const column =
    countColumn(
      state.sliceDoc(line.from, main.head),
      state.tabSize,
      main.head - line.from,
    ) + 1;
  let selectedLength = 0;
  for (const range of state.selection.ranges)
    selectedLength += range.to - range.from;
  return {
    line: line.number + lineStart - 1,
    column,
    selections: state.selection.ranges.length,
    selectedLength,
  };
}
