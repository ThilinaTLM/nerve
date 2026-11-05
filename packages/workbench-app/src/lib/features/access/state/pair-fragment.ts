/** Pairing codes are 8 Crockford base32 characters, displayed `XXXX-XXXX`. */
const CODE_PATTERN = /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/;

/**
 * Normalizes user-typed or pasted code text to `XXXX-XXXX`; `undefined` when
 * it cannot be a code. Case and a missing/extra separator are forgiven.
 */
export function normalizePairingCode(input: string): string | undefined {
  const compact = input.trim().replace(/[\s-]+/g, "");
  if (!CODE_PATTERN.test(compact)) return undefined;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`.toUpperCase();
}

/** Reads the `pair` parameter of a `#pair=CODE` fragment. */
export function parsePairFragment(hash: string): string | undefined {
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  const value = params.get("pair");
  return value ? normalizePairingCode(value) : undefined;
}

/** The fragment without its `pair` parameter, keeping unrelated parameters. */
export function fragmentWithoutPair(hash: string): string {
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  if (!params.has("pair")) return hash;
  params.delete("pair");
  const rest = params.toString();
  return rest ? `#${rest}` : "";
}

interface FragmentLocation {
  pathname: string;
  search: string;
  hash: string;
}

interface FragmentHistory {
  replaceState(data: unknown, unused: string, url?: string | null): void;
}

/**
 * Takes the pairing code out of the address bar. The code is removed from the
 * URL immediately (so it is not bookmarked, shared or kept in history) and
 * returned to the caller, which keeps it in memory only.
 */
export function consumePairFragment(
  location: FragmentLocation,
  history: FragmentHistory,
): string | undefined {
  const code = parsePairFragment(location.hash);
  if (!code) return undefined;
  history.replaceState(
    history,
    "",
    `${location.pathname}${location.search}${fragmentWithoutPair(location.hash)}`,
  );
  return code;
}
