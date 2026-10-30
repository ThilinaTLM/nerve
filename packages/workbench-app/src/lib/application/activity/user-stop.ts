/** A user-initiated Stop ends as idle; its edge must stay silent for this long. */
const STOP_SUPPRESSION_MS = 30_000;

const stops = new Map<string, number>();

/** The user pressed Stop here: the next finished/interrupted edge is silent. */
export function suppressNextCompletion(
  conversationId: string,
  now = Date.now(),
): void {
  stops.set(conversationId, now + STOP_SUPPRESSION_MS);
}

/** True once if a recent Stop covers this edge. */
export function consumeSuppressedCompletion(
  conversationId: string,
  now = Date.now(),
): boolean {
  const until = stops.get(conversationId);
  if (until === undefined) return false;
  stops.delete(conversationId);
  return until >= now;
}

export function clearSuppressedCompletion(conversationId: string): void {
  stops.delete(conversationId);
}
