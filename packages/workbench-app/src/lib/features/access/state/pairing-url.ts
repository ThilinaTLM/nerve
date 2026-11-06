import type { PairingCode, PairingLink } from "@nervekit/contracts/access";

/**
 * The links a second device can open. The code lives in the URL fragment,
 * which browsers never send to servers or proxies. The daemon lists one link
 * per network it is reachable on; without any, this page's origin is the only
 * option (e.g. a remote browser already on the HTTPS address).
 */
export function pairingLinks(code: PairingCode, origin: string): PairingLink[] {
  if (code.links.length > 0) return code.links;
  return [
    {
      kind: "other",
      label: "This address",
      url: `${origin}/#pair=${code.code}`,
    },
  ];
}

/**
 * Initial choice: the remembered network, else the network this page is open
 * on, else the daemon's best link.
 */
export function defaultPairingLink(
  links: readonly PairingLink[],
  input: { remembered?: string; origin: string },
): PairingLink | undefined {
  return (
    links.find((link) => link.label === input.remembered) ??
    links.find((link) => new URL(link.url).origin === input.origin) ??
    links[0]
  );
}
