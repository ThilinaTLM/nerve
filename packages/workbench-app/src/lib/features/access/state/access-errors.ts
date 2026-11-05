import { ApiRequestError } from "$lib/platform/http/api-client";

/** Copy for every access error the pairing/passkey screens can surface. */
const MESSAGES: Record<string, string> = {
  TLS_REQUIRED:
    "This connection is not encrypted, so devices can't be paired over it. Open Nerve through its HTTPS address.",
  PAIRING_CODE_INVALID:
    "That code isn't valid. It may have expired or already been used. Generate a new one in Nerve on your computer.",
  PASSKEY_ENROLLMENT_REQUIRED:
    "Set up a passkey first. Use the setup code printed by the Nerve daemon or run `nerve pair --enroll`.",
  PASSKEY_NOT_ENROLLED: "No passkey is set up for this Nerve yet.",
  PASSKEY_VERIFICATION_FAILED:
    "The passkey could not be verified. Try again or use a different passkey.",
  PASSKEY_LAST_REMAINING:
    "This is your only passkey. Add another one before removing it.",
  PUBLIC_URL_REQUIRED:
    "Passkeys need a public HTTPS address. Set Nerve's public URL and open it from there.",
  LOCAL_ONLY: "This action is only available on the computer running Nerve.",
  DEVICE_NOT_FOUND: "That device is no longer registered.",
  UNAUTHORIZED: "You're signed out. Reload to pair this device again.",
  FORBIDDEN: "This device isn't allowed to do that.",
  MISDIRECTED_REQUEST:
    "Nerve doesn't serve this address. Use the address shown on your computer.",
};

export function formatRetryAfter(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.ceil(seconds))} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** User-facing message for a failed access request. */
export function describeAccessError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "RATE_LIMITED") {
      return error.retryAfterSeconds === undefined
        ? "Too many attempts. Wait a little and try again."
        : `Too many attempts. Try again in ${formatRetryAfter(error.retryAfterSeconds)}.`;
    }
    if (error.code && MESSAGES[error.code]) return MESSAGES[error.code]!;
    if (error.message) return error.message;
    return "The request failed.";
  }
  if (isWebAuthnAbort(error)) {
    return "The passkey prompt was cancelled or timed out.";
  }
  if (error instanceof TypeError) {
    return "Couldn't reach Nerve. Check your connection and try again.";
  }
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong.";
}

/** `NotAllowedError` / `AbortError`: the user dismissed the browser's passkey UI. */
export function isWebAuthnAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "NotAllowedError" || error.name === "AbortError";
}
