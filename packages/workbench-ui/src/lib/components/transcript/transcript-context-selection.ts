type SelectionRange = {
  intersectsNode(node: Node): boolean;
};

type TextSelection = {
  isCollapsed: boolean;
  rangeCount: number;
  getRangeAt(index: number): SelectionRange;
  toString(): string;
};

/** Return the active selection only when it overlaps the right-clicked row. */
export function selectedTextForTranscriptRow(
  selection: TextSelection | null,
  row: Node,
): string | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return undefined;
  }

  const text = selection.toString();
  if (!text.trim()) return undefined;

  try {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      if (selection.getRangeAt(index).intersectsNode(row)) return text;
    }
  } catch {
    // A range can become detached while virtualized transcript rows change.
  }
  return undefined;
}
