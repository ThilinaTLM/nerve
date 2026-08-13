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

export const TAB_REORDER_OVERLAP_THRESHOLD = 0.6;

function horizontalOverlap(
  left: number,
  width: number,
  bound: HorizontalTabBound,
): number {
  return Math.max(
    0,
    Math.min(left + width, bound.left + bound.width) -
      Math.max(left, bound.left),
  );
}

export function initialTabIndexAtOverlap({
  draggedLeft,
  draggedWidth,
  direction,
  remainingTabs,
  threshold = TAB_REORDER_OVERLAP_THRESHOLD,
}: {
  draggedLeft: number;
  draggedWidth: number;
  direction: -1 | 0 | 1;
  remainingTabs: readonly HorizontalTabBound[];
  threshold?: number;
}): number | undefined {
  if (remainingTabs.length === 0) return 0;
  const first = remainingTabs[0];
  const last = remainingTabs[remainingTabs.length - 1];
  if (draggedLeft + draggedWidth <= first.left) return 0;
  if (draggedLeft >= last.left + last.width) return remainingTabs.length;

  const coveredIndex = remainingTabs.findIndex(
    (tab) =>
      tab.width > 0 &&
      horizontalOverlap(draggedLeft, draggedWidth, tab) >=
        tab.width * threshold,
  );
  if (coveredIndex < 0) return undefined;
  if (direction !== 0) return coveredIndex + (direction > 0 ? 1 : 0);

  const draggedCenter = draggedLeft + draggedWidth / 2;
  const covered = remainingTabs[coveredIndex];
  return (
    coveredIndex + (draggedCenter >= covered.left + covered.width / 2 ? 1 : 0)
  );
}

export function adjacentTabIndexAtOverlap({
  draggedKey,
  orderedKeys,
  draggedLeft,
  draggedWidth,
  direction,
  remainingTabs,
  threshold = TAB_REORDER_OVERLAP_THRESHOLD,
}: {
  draggedKey: string;
  orderedKeys: readonly string[];
  draggedLeft: number;
  draggedWidth: number;
  direction: -1 | 0 | 1;
  remainingTabs: readonly HorizontalTabBound[];
  threshold?: number;
}): number {
  const currentIndex = orderedKeys.indexOf(draggedKey);
  if (currentIndex < 0 || direction === 0) return currentIndex;

  const adjacentIndex = currentIndex + direction;
  const adjacentKey = orderedKeys[adjacentIndex];
  const adjacent = remainingTabs.find((tab) => tab.key === adjacentKey);
  if (!adjacent || adjacent.width <= 0) return currentIndex;

  const overlap = horizontalOverlap(draggedLeft, draggedWidth, adjacent);
  return overlap >= adjacent.width * threshold ? adjacentIndex : currentIndex;
}
