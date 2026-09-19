/** Layout and filtering rules for the composer's tools-and-skills panel.
 *
 * Both tabs share one geometry: the body is sized from the longer list, and the
 * filter field appears based on both counts, so switching tabs never resizes the
 * popover under the pointer. */

/** Above this many rows in either tab, the panel offers a filter field. */
export const CAPABILITY_SEARCH_THRESHOLD = 8;
/** Matches the row's `min-h-7`. */
export const CAPABILITY_ROW_REM = 1.75;
/** The body's `pb-2`, so the last visible row is not clipped by padding. */
export const CAPABILITY_BODY_PADDING_REM = 0.5;
export const CAPABILITY_MIN_ROWS = 4;
export const CAPABILITY_MAX_ROWS = 9;

export function showCapabilitySearch(
  toolCount: number,
  skillCount: number,
): boolean {
  return Math.max(toolCount, skillCount) > CAPABILITY_SEARCH_THRESHOLD;
}

export function capabilityBodyHeight(
  toolCount: number,
  skillCount: number,
): string {
  const rows = Math.min(
    Math.max(Math.max(toolCount, skillCount), CAPABILITY_MIN_ROWS),
    CAPABILITY_MAX_ROWS,
  );
  return `${rows * CAPABILITY_ROW_REM + CAPABILITY_BODY_PADDING_REM}rem`;
}

export function filterCapabilityRows<T extends { label: string }>(
  rows: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => row.label.toLowerCase().includes(needle));
}
