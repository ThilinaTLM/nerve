/**
 * Which list row currently shows its swipe actions. Only one row may be open
 * at a time, so opening another (or touching anything else) closes the first.
 */
export const openSwipeRow = $state<{ id?: number }>({});

let nextRowId = 0;

export function createSwipeRowId(): number {
  nextRowId += 1;
  return nextRowId;
}
