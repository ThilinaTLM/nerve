import type { EditorState } from "@codemirror/state";

export function contextSelection(
  state: EditorState,
  position: number,
): { anchor: number; head?: number } | undefined {
  const insideSelection = state.selection.ranges.some(
    (range) => !range.empty && position >= range.from && position <= range.to,
  );
  return insideSelection ? undefined : { anchor: position };
}
