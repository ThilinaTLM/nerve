import type { AccessSession } from "@nervekit/contracts/access";

export type AccessScreen =
  | "app"
  | "pair"
  | "passkey-login"
  | "passkey-enroll"
  | "blocked";

/**
 * Which screen an unauthenticated (or authenticated) visitor sees. Passkey
 * enrollment wins while the server is waiting for its first passkey, because
 * nothing else can sign in then; login wins over pairing when it is possible.
 * A pairing code from the URL fragment goes straight to the pairing screen.
 */
export function resolveAccessScreen(
  session: AccessSession,
  options: { pendingPairCode?: string } = {},
): AccessScreen {
  if (session.authenticated) return "app";
  if (session.passkey.enrollmentOpen) return "passkey-enroll";
  if (options.pendingPairCode && session.pairingAvailable) return "pair";
  if (session.passkey.loginAvailable) return "passkey-login";
  if (session.pairingAvailable) return "pair";
  return "blocked";
}

/** Whether a secondary "use a pairing code instead" action makes sense. */
export function canFallBackToPairing(session: AccessSession): boolean {
  return session.pairingAvailable;
}
