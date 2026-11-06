import type { PairingLinkKind } from "@nervekit/contracts/access";
import {
  isLoopbackHost,
  isPrivateIpv4,
  isVirtualInterface,
  isWildcardHost,
} from "./host.js";

/** Minimal shape of one `os.networkInterfaces()` address entry. */
export interface InterfaceAddress {
  family: string | number;
  internal: boolean;
  address: string;
}

export type InterfacesSnapshot = Record<string, InterfaceAddress[] | undefined>;

export type ShareNetworkKind = Exclude<PairingLinkKind, "public">;

export interface ShareOrigin {
  kind: ShareNetworkKind;
  label: string;
  /** Mobile HTTPS origin of the app. */
  origin: string;
  /** Plain-HTTP origin on the same address; serves `/mobile-setup` (CA install). */
  setupOrigin: string;
}

const KIND_ORDER: readonly ShareNetworkKind[] = [
  "lan",
  "tailscale",
  "vpn",
  "other",
];

const KIND_LABEL: Record<ShareNetworkKind, string> = {
  lan: "Local network",
  tailscale: "Tailscale",
  vpn: "VPN",
  other: "Other network",
};

/** Tailscale (and other overlay) addresses live in the 100.64.0.0/10 CGNAT range. */
function isCgnatIpv4(address: string): boolean {
  const [first, second] = address.split(".").map(Number);
  return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

export function classifyShareNetwork(
  address: string,
  interfaceName = "",
): ShareNetworkKind {
  if (/^tailscale/i.test(interfaceName) || isCgnatIpv4(address)) {
    return "tailscale";
  }
  if (/^(wg|tun|tap|utun|ppp|zt|ipsec)/i.test(interfaceName)) return "vpn";
  if (isPrivateIpv4(address)) return "lan";
  return "other";
}

/**
 * HTTPS origins another device can open to reach this daemon, one per network,
 * best first (local network, Tailscale, VPN, other). Only addresses the mobile
 * certificate covers are offered, so a network joined after startup appears
 * once the daemon restarts and reissues the certificate. Container and VM
 * bridges are skipped: no other device sits behind them.
 */
export function listShareOrigins(input: {
  boundHost: string;
  httpPort: number;
  httpsPort: number;
  certifiedHosts: readonly string[];
  interfaces: InterfacesSnapshot;
}): ShareOrigin[] {
  const certified = new Set(input.certifiedHosts);
  const found: Array<{
    address: string;
    name: string;
    kind: ShareNetworkKind;
  }> = [];
  for (const [name, addresses] of Object.entries(input.interfaces)) {
    for (const entry of addresses ?? []) {
      const ipv4 = entry.family === "IPv4" || entry.family === 4;
      if (!ipv4 || entry.internal || !certified.has(entry.address)) continue;
      if (
        !isWildcardHost(input.boundHost) &&
        entry.address !== input.boundHost
      ) {
        continue;
      }
      if (isWildcardHost(input.boundHost) && isVirtualInterface(name)) continue;
      found.push({
        address: entry.address,
        name,
        kind: classifyShareNetwork(entry.address, name),
      });
    }
  }
  if (
    found.length === 0 &&
    !isWildcardHost(input.boundHost) &&
    !isLoopbackHost(input.boundHost) &&
    certified.has(input.boundHost)
  ) {
    // Bound to a hostname or an address no interface reports.
    found.push({
      address: input.boundHost,
      name: "",
      kind: classifyShareNetwork(input.boundHost),
    });
  }

  const unique = [
    ...new Map(found.map((entry) => [entry.address, entry])).values(),
  ].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const perKind = new Map<ShareNetworkKind, number>();
  for (const entry of unique) {
    perKind.set(entry.kind, (perKind.get(entry.kind) ?? 0) + 1);
  }
  return unique.map((entry) => {
    const origin = new URL(`https://127.0.0.1:${input.httpsPort}`);
    origin.hostname = entry.address;
    const setupOrigin = new URL(`http://127.0.0.1:${input.httpPort}`);
    setupOrigin.hostname = entry.address;
    const base = KIND_LABEL[entry.kind];
    const label =
      (perKind.get(entry.kind) ?? 0) > 1 && entry.name
        ? `${base} (${entry.name})`
        : base;
    return {
      kind: entry.kind,
      label,
      origin: origin.origin,
      setupOrigin: setupOrigin.origin,
    };
  });
}
