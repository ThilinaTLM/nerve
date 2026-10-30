/** Reasons are stable labels, not identities. Paths belong in quarantine receipts. */
export function reportReason(reason: string): string {
  return reason
    .replace(/(?<![\w])(?:[A-Za-z]:[\\/]|\/)[^\s:;,]+:?\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function aggregateLosses(
  entries: readonly { reason: string; count: number }[],
): Array<{ reason: string; count: number }> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const reason = reportReason(entry.reason);
    totals.set(reason, (totals.get(reason) ?? 0) + entry.count);
  }
  return [...totals].map(([reason, count]) => ({ reason, count }));
}
