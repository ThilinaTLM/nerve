import { foldable, foldedRanges } from "@codemirror/language";
import type { SearchQuery } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";

export type SearchMatchStatus = {
  count: number;
  current?: number;
  capped: boolean;
};

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

export function contextSelection(
  state: EditorState,
  position: number,
): { anchor: number; head?: number } | undefined {
  const insideSelection = state.selection.ranges.some(
    (range) => !range.empty && position >= range.from && position <= range.to,
  );
  return insideSelection ? undefined : { anchor: position };
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
