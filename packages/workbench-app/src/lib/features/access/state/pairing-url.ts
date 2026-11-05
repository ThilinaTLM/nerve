import type { PairingCode } from "@nervekit/contracts/access";

/**
 * The link a second device opens. The code lives in the URL fragment, which
 * browsers never send to servers or proxies. The server supplies the public
 * URL form when `network.publicUrl` is set; otherwise use this page's origin.
 */
export function pairingUrl(code: PairingCode, origin: string): string {
  return code.url ?? `${origin}/#pair=${code.code}`;
}
