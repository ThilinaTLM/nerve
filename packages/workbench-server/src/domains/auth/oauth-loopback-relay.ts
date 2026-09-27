const MAX_REDIRECT_URL_LENGTH = 8_192;
const RELAY_TIMEOUT_MS = 5_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A callback destination derived from an authorization URL emitted by the OAuth provider. */
export type OAuthLoopbackRelayTarget = Readonly<{
  redirectUri: string;
  state: string;
}>;

export type OAuthLoopbackRelayResult = Readonly<{
  status: number;
}>;

function parseUrl(value: string): URL | undefined {
  if (value.length === 0 || value.length > MAX_REDIRECT_URL_LENGTH)
    return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isLoopbackCallback(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.port !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
  );
}

function hasOneParameter(url: URL, name: string): boolean {
  return url.searchParams.getAll(name).length === 1;
}

/**
 * Derives a relay target only from the authorization URL observed by the
 * server. Unrelated and non-loopback redirect URIs are intentionally ignored.
 */
export function deriveOAuthLoopbackRelayTarget(
  authorizationUrl: string,
): OAuthLoopbackRelayTarget | undefined {
  const authorization = parseUrl(authorizationUrl);
  if (
    !authorization ||
    !hasOneParameter(authorization, "redirect_uri") ||
    !hasOneParameter(authorization, "state")
  ) {
    return undefined;
  }

  const redirectUri = authorization.searchParams.get("redirect_uri");
  const state = authorization.searchParams.get("state");
  if (!redirectUri || !state) return undefined;

  const redirect = parseUrl(redirectUri);
  if (!redirect || !isLoopbackCallback(redirect)) return undefined;

  return { redirectUri: redirect.href, state };
}

/**
 * Validates a pasted browser redirect against the previously observed target.
 * The returned URL is safe to pass to {@link relayOAuthLoopbackRedirect}.
 */
export function validateOAuthLoopbackRedirect(
  target: OAuthLoopbackRelayTarget,
  pastedRedirect: string,
): URL {
  const expected = parseUrl(target.redirectUri);
  const actual = parseUrl(pastedRedirect.trim());
  if (!expected || !actual || !isLoopbackCallback(expected)) {
    throw new Error("OAuth redirect target is not a loopback HTTP callback.");
  }
  if (!isLoopbackCallback(actual)) {
    throw new Error("OAuth redirect must be a loopback HTTP callback URL.");
  }

  if (
    actual.protocol !== expected.protocol ||
    actual.hostname !== expected.hostname ||
    actual.port !== expected.port ||
    actual.pathname !== expected.pathname
  ) {
    throw new Error(
      "OAuth redirect does not match the expected callback target.",
    );
  }

  for (const name of new Set(expected.searchParams.keys())) {
    const expectedValues = expected.searchParams.getAll(name);
    const actualValues = actual.searchParams.getAll(name);
    if (
      expectedValues.length !== actualValues.length ||
      !expectedValues.every((entry, index) => entry === actualValues[index])
    ) {
      throw new Error(
        `OAuth redirect does not preserve callback parameter ${name}.`,
      );
    }
  }

  const states = actual.searchParams.getAll("state");
  if (states.length !== 1 || states[0] !== target.state) {
    throw new Error("OAuth redirect state does not match the active login.");
  }
  const codes = actual.searchParams.getAll("code");
  const errors = actual.searchParams.getAll("error");
  if (
    (codes.length !== 1 && errors.length !== 1) ||
    codes.length > 1 ||
    errors.length > 1 ||
    (codes.length === 1 && errors.length === 1)
  ) {
    throw new Error(
      "OAuth redirect must contain exactly one authorization code or error.",
    );
  }

  return actual;
}

function relayUrlFor(validatedRedirect: URL): URL {
  const relayUrl = new URL(validatedRedirect);
  // Never resolve a hostname during the relay. OAuth libraries commonly
  // advertise localhost while binding their callback listener to IPv4.
  if (relayUrl.hostname === "localhost") relayUrl.hostname = "127.0.0.1";
  return relayUrl;
}

/**
 * Relays one bounded GET to the validated local callback. Redirect responses
 * are not followed, so the relay can never be used as a general-purpose SSRF
 * primitive.
 */
export async function relayOAuthLoopbackRedirect(
  target: OAuthLoopbackRelayTarget,
  pastedRedirect: string,
  signal?: AbortSignal,
): Promise<OAuthLoopbackRelayResult> {
  const validated = validateOAuthLoopbackRedirect(target, pastedRedirect);
  const timeoutSignal = AbortSignal.timeout(RELAY_TIMEOUT_MS);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(relayUrlFor(validated), {
    method: "GET",
    redirect: "manual",
    signal: requestSignal,
    headers: { accept: "text/html, application/xhtml+xml" },
  });
  const status = response.status;
  await response.body?.cancel().catch(() => undefined);
  return { status };
}
