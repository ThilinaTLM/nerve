import type { PairingCode } from "@nervekit/contracts/access";
import type { DaemonFile } from "@nervekit/contracts/status";
import {
  isLoopbackHost,
  isPrivateIpv4,
  isVirtualInterface,
  isWildcardHost,
} from "@nervekit/workbench-server";
import type { ShareUrls } from "./contracts.js";

/**
 * Pure URL/host policy for daemon connections and LAN/mobile sharing. The
 * network-interface snapshot is injected so wildcard LAN address selection is
 * deterministic under test.
 */

/** Minimal shape of one `os.networkInterfaces()` address entry. */
export interface NetworkInterfaceAddress {
  family: string | number;
  internal: boolean;
  address: string;
}

export type NetworkInterfacesSnapshot = Record<
  string,
  NetworkInterfaceAddress[] | undefined
>;

export function normalizeRemoteDaemonUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote daemon URL must use http:// or https://.");
  }
  return url.origin;
}

/** Convert a locally advertised daemon URL into a connectable origin. */
export function localConnectUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:") return undefined;
    if (url.hostname === "0.0.0.0" || url.hostname === "::") {
      url.hostname = "127.0.0.1";
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

// Re-exported so daemon peers can keep importing from ./urls.js.
export { isLoopbackHost } from "@nervekit/workbench-server";
/** Credential-free origins that pairing links are built on. */
export interface ShareEndpoints {
  /** Plain-HTTP LAN origin; serves only the secret-free `/mobile-setup` page. */
  setupOrigin: string;
  /** Mobile HTTPS LAN origin of the app itself. */
  secureOrigin: string;
  caCertUrl: string;
}

/**
 * Where a phone can reach this daemon, or `undefined` when it cannot (loopback
 * bind, no mobile HTTPS). Contains no secret: links are completed later with a
 * single-use pairing code.
 */
export function buildShareEndpoints(
  daemon: DaemonFile,
  interfaces: NetworkInterfacesSnapshot,
): ShareEndpoints | undefined {
  if (!daemon.mobileHttps) return undefined;
  const host = remoteShareHost(daemon.host, interfaces);
  if (!host) return undefined;
  const secureOrigin = new URL(`https://127.0.0.1:${daemon.mobileHttps.port}`);
  secureOrigin.hostname = host;
  const setupOrigin = new URL(`http://127.0.0.1:${daemon.port}`);
  setupOrigin.hostname = host;
  return {
    setupOrigin: setupOrigin.origin,
    secureOrigin: secureOrigin.origin,
    caCertUrl: `${setupOrigin.origin}/nerve-local-ca.pem`,
  };
}

/**
 * Completes the share links with a pairing code. The code rides in the URL
 * fragment, which browsers never send to servers or proxies. When the daemon
 * has a public URL the server returns the link to use for the app itself.
 */
export function buildShareUrls(
  endpoints: ShareEndpoints,
  pairing: Pick<PairingCode, "code" | "url">,
): ShareUrls {
  const fragment = `#pair=${pairing.code}`;
  return {
    mobileSetupUrl: `${endpoints.setupOrigin}/mobile-setup${fragment}`,
    secureShareUrl: pairing.url ?? `${endpoints.secureOrigin}/${fragment}`,
  };
}

function remoteShareHost(
  boundHost: string,
  interfaces: NetworkInterfacesSnapshot,
): string | undefined {
  if (isWildcardHost(boundHost)) return firstLanIpv4Address(interfaces);
  if (isLoopbackHost(boundHost)) return undefined;
  if (boundHost.includes(":")) return undefined;
  return boundHost;
}

/**
 * Deterministic wildcard-bind share address preference: private IPv4 on a
 * physical interface, then any private IPv4, then any physical interface,
 * then the first external IPv4 address.
 */
export function firstLanIpv4Address(
  interfaces: NetworkInterfacesSnapshot,
): string | undefined {
  const candidates: Array<{ name: string; address: string }> = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (
        (address.family === "IPv4" || address.family === 4) &&
        !address.internal
      ) {
        candidates.push({ name, address: address.address });
      }
    }
  }

  return (
    candidates.find(
      (candidate) =>
        isPrivateIpv4(candidate.address) && !isVirtualInterface(candidate.name),
    )?.address ??
    candidates.find((candidate) => isPrivateIpv4(candidate.address))?.address ??
    candidates.find((candidate) => !isVirtualInterface(candidate.name))
      ?.address ??
    candidates[0]?.address
  );
}
