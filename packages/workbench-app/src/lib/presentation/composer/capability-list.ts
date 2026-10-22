/** Layout and filtering rules for the composer's capabilities popover.
 * Tools and skills share a body height; search depends on the active list. */

export type CapabilityDecisionOrigin = "conversation" | "project" | "user";

/** Matches the row's `min-h-7`. */
export const CAPABILITY_ROW_REM = 1.75;
/** The body's `pb-2`, so the last visible row is not clipped by padding. */
export const CAPABILITY_BODY_PADDING_REM = 0.5;
export const CAPABILITY_MIN_ROWS = 4;
export const CAPABILITY_MAX_ROWS = 9;

/** The panel offers a filter field once a list no longer fits without scrolling. */
export function showCapabilitySearch(rowCount: number): boolean {
  return rowCount > CAPABILITY_MAX_ROWS;
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

export function filterCapabilityRows<
  T extends { label: string; searchText?: string },
>(rows: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    `${row.label} ${row.searchText ?? ""}`.toLowerCase().includes(needle),
  );
}
