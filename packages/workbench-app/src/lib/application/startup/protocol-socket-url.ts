/**
 * The protocol WebSocket address. A page served over HTTP(S) connects back to
 * its own origin (the daemon, a LAN listener or the Tailscale address),
 * otherwise the daemon's advertised `wsUrl` is used.
 */
export function protocolSocketUrl(
  wsUrl: string,
  pathname: "/ws/workbench" | "/ws/conversations",
  location:
    | { protocol: string; host: string }
    | undefined = globalThis.location,
): string {
  const url =
    location?.protocol === "http:" || location?.protocol === "https:"
      ? // Built from the page's host rather than assigned to `url.host`: a host
        // without a port (`:443`) leaves the daemon's port in place.
        new URL(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`,
        )
      : new URL(wsUrl);
  url.pathname = pathname;
  return url.href;
}
