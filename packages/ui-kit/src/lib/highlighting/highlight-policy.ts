export const MAX_HIGHLIGHT_CODE_UNITS = 8_000;
export const MAX_HIGHLIGHT_LOGICAL_LINES = 160;

/**
 * Keeps regex tokenization bounded without allocating a line array for large
 * tool output. Boundaries are inclusive.
 */
export function isWithinHighlightBudget(code: string): boolean {
  if (code.length > MAX_HIGHLIGHT_CODE_UNITS) return false;

  let lines = 1;
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) !== 10) continue;
    lines += 1;
    if (lines > MAX_HIGHLIGHT_LOGICAL_LINES) return false;
  }
  return true;
}
