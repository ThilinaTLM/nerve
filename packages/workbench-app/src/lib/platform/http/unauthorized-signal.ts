const listeners = new Set<() => void>();

/**
 * Called when an API request is rejected because the browser has no valid
 * credential (401 UNAUTHORIZED, expired or revoked device). The access gate
 * re-checks the session and routes the user to pairing or passkey login.
 */
export function notifyUnauthorized(): void {
  for (const listener of [...listeners]) listener();
}

export function onUnauthorized(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 401s that mean "not signed in", as opposed to a failed attempt such as a bad
 * passkey assertion (`PASSKEY_VERIFICATION_FAILED`) on a public access route.
 */
export function isSessionLostResponse(
  status: number | undefined,
  code: string | undefined,
): boolean {
  return status === 401 && (code === undefined || code === "UNAUTHORIZED");
}
