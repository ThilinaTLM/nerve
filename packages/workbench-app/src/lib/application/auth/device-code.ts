/** Whole seconds until a device code expires, never below zero; undefined when it has no expiry. */
export function deviceCodeSecondsRemaining(
  expiresAt: string | undefined,
  now: number,
): number | undefined {
  if (!expiresAt) return undefined;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return undefined;
  return Math.max(0, Math.ceil((expiry - now) / 1_000));
}
