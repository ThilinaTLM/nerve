/**
 * Adds a conversation row unless one with the same id is already present.
 * An existing row came from a server notice and is at least as fresh as a
 * locally built snapshot row, so it wins; duplicates would let stale data
 * shadow later patches.
 */
export function withConversationRow<Row extends { id: string }>(
  rows: Row[],
  row: Row,
): Row[] {
  return rows.some((existing) => existing.id === row.id)
    ? rows
    : [...rows, row];
}
