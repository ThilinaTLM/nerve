export type HorizontalTabBound = {
  key: string;
  left: number;
  width: number;
};

export function moveTabKey(
  keys: readonly string[],
  draggedKey: string,
  targetIndex: number,
): string[] {
  const sourceIndex = keys.indexOf(draggedKey);
  if (sourceIndex < 0) return [...keys];
  const reordered = keys.filter((key) => key !== draggedKey);
  const bounded = Math.max(0, Math.min(targetIndex, reordered.length));
  reordered.splice(bounded, 0, draggedKey);
  return reordered;
}

export function insertionIndexAtX(
  clientX: number,
  remainingTabs: readonly HorizontalTabBound[],
): number {
  const index = remainingTabs.findIndex(
    (tab) => clientX < tab.left + tab.width / 2,
  );
  return index < 0 ? remainingTabs.length : index;
}
