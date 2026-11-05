/**
 * Browser isolation shared by HTTP and WebSocket upgrades. Evaluated before
 * credentials: dev proxies may inject bearer tokens.
 */
export function isBlockedBrowserRequest(input: {
  origin: string | null | undefined;
  site: string | null | undefined;
  requestOrigin: string;
}): boolean {
  const { origin, site } = input;
  if (origin === "null" || site === "cross-site") return true;
  // Same-site is not same-origin (ports and sibling hosts can differ).
  if (site === "same-site") return true;
  // Browsers set this forbidden header; reverse proxies may rewrite upstream host/scheme.
  if (site === "same-origin") return false;
  if (origin && origin !== input.requestOrigin) return true;
  return false;
}

/**
 * Cookie credentials are ambient, so a state-changing request or a WebSocket
 * must positively prove it is same-origin (Origin match or `sec-fetch-site`).
 */
export function hasSameOriginProof(input: {
  origin: string | null | undefined;
  site: string | null | undefined;
  requestOrigin: string;
}): boolean {
  return input.site === "same-origin" || input.origin === input.requestOrigin;
}
