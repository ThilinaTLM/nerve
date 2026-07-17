import type { DaemonFile } from "@nervekit/contracts";
import type { ShareUrls } from "./types.js";

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

/** Converts a locally advertised daemon URL into a connectable origin. */
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

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.")
  );
}

export function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

export function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function isVirtualInterface(name: string): boolean {
  return /^(br-|docker|veth|virbr|vmnet|vboxnet|lo)/i.test(name);
}

export function buildShareUrls(
  daemon: DaemonFile,
  token: string,
  interfaces: NetworkInterfacesSnapshot,
): ShareUrls {
  const shareUrl = remoteShareUrl(daemon, token, interfaces);
  const secureUrls = remoteSecureUrls(daemon, token, interfaces);
  return {
    shareUrl,
    mobileSetupUrl: secureUrls?.mobileSetupUrl,
    secureShareUrl: secureUrls?.secureShareUrl,
    caCertUrl: secureUrls?.caCertUrl,
  };
}

function remoteShareUrl(
  daemon: DaemonFile,
  token: string,
  interfaces: NetworkInterfacesSnapshot,
): string | undefined {
  const host = remoteShareHost(daemon.host, interfaces);
  if (!host) return undefined;
  const url = new URL(`http://127.0.0.1:${daemon.port}/`);
  url.hostname = host;
  url.searchParams.set("token", token);
  return url.toString();
}

function remoteSecureUrls(
  daemon: DaemonFile,
  token: string,
  interfaces: NetworkInterfacesSnapshot,
):
  | { mobileSetupUrl: string; secureShareUrl: string; caCertUrl: string }
  | undefined {
  if (!daemon.mobileHttps) return undefined;
  const host = remoteShareHost(daemon.host, interfaces);
  if (!host) return undefined;
  const secureShareUrl = new URL(
    `https://127.0.0.1:${daemon.mobileHttps.port}/`,
  );
  secureShareUrl.hostname = host;
  secureShareUrl.searchParams.set("token", token);

  const mobileSetupUrl = new URL(
    `http://127.0.0.1:${daemon.port}/mobile-setup`,
  );
  mobileSetupUrl.hostname = host;
  mobileSetupUrl.searchParams.set("token", token);

  const caCertUrl = new URL(
    `http://127.0.0.1:${daemon.port}/nerve-local-ca.pem`,
  );
  caCertUrl.hostname = host;

  return {
    mobileSetupUrl: mobileSetupUrl.toString(),
    secureShareUrl: secureShareUrl.toString(),
    caCertUrl: caCertUrl.toString(),
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
