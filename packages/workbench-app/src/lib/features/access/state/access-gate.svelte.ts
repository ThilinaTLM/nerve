import type { AccessSession } from "@nervekit/contracts/access";
import { onUnauthorized } from "$lib/platform/http/unauthorized-signal";
import { getAccessSession } from "../api/access.api";
import { resolveAccessScreen, type AccessScreen } from "./access-routing";
import { consumePairFragment } from "./pair-fragment";

const RETRY_DELAY_MS = 1000;

export const accessGate = $state({
  /** `checking` until the first session answer arrives. */
  phase: "checking" as "checking" | "settled",
  session: undefined as AccessSession | undefined,
  screen: "app" as AccessScreen,
  /** Code from `#pair=…`, held in memory only (the URL is already clean). */
  pendingPairCode: undefined as string | undefined,
});

let appWasShown = false;
/** When the credential of a running app was first seen missing. */
let lostAt: number | undefined;
/**
 * A rotated or re-installed credential (desktop shell after a local token
 * rotation) is repaired within moments; only a loss that outlasts this reloads.
 */
const CREDENTIAL_GRACE_MS = 2000;

function apply(session: AccessSession): void {
  const screen = resolveAccessScreen(session, {
    pendingPairCode: accessGate.pendingPairCode,
  });
  if (screen !== "app" && appWasShown) {
    lostAt ??= Date.now();
    if (Date.now() - lostAt < CREDENTIAL_GRACE_MS) {
      setTimeout(() => void refreshAccessSession(), CREDENTIAL_GRACE_MS);
      return;
    }
    // The credential was revoked or expired mid-session: restart from a clean
    // page so no cached workspace state outlives the sign-out.
    location.reload();
    return;
  }
  lostAt = undefined;
  accessGate.session = session;
  accessGate.screen = screen;
  accessGate.phase = "settled";
  if (screen === "app") appWasShown = true;
}

/** Fetches the session; retries while the daemon is still starting. */
async function fetchSession(): Promise<AccessSession> {
  for (;;) {
    try {
      return await getAccessSession();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

/** Re-reads the session and routes accordingly (after sign-in or a 401). */
export async function refreshAccessSession(): Promise<void> {
  apply(await fetchSession());
}

/** Forgets a code that was already consumed, successfully or not. */
export function clearPendingPairCode(): void {
  accessGate.pendingPairCode = undefined;
}

/**
 * Starts access bootstrap: lifts any `#pair=` code out of the URL, checks the
 * session, and re-checks whenever an API call reports a lost credential.
 */
export function startAccessGate(): () => void {
  accessGate.pendingPairCode = consumePairFragment(
    window.location,
    window.history,
  );
  let rechecking = false;
  const stop = onUnauthorized(() => {
    if (rechecking) return;
    rechecking = true;
    void refreshAccessSession().finally(() => {
      rechecking = false;
    });
  });
  void refreshAccessSession();
  return stop;
}
