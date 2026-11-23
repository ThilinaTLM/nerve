import { networkInterfaces } from "node:os";
import { isWildcardHost } from "../../infrastructure/network/host.js";

export type HostAllowlist = (hostHeader: string | null | undefined) => boolean;

export interface HostAllowlistSource {
  /** Address the daemon is bound to. Read lazily: tests and boot mutate it. */
  host: string;
  /** Hosts the mobile HTTPS certificate covers (LAN addresses). */
  mobileHttps?: { hosts: string[] };
  /** `network.publicUrl` and private tunnel hosts, once access knows them. */
  access?: { publicHost: string | undefined; tunnelHost?: string | undefined };
}

/** Extra hostnames from `NERVE_ALLOWED_HOSTS` (comma separated), for DNS names. */
function configuredHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.NERVE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => normalizeHostname(entry))
    .filter(Boolean);
}

/** Lowercase hostname without port, IPv6 brackets or trailing dot. */
export function normalizeHostname(value: string): string {
  let host = value.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end === -1 ? host.slice(1) : host.slice(1, end);
  } else if (host.indexOf(":") === host.lastIndexOf(":")) {
    // Exactly zero or one colon: a name or IPv4 with optional port.
    host = host.split(":")[0] ?? "";
  }
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

/** Exact loopback names and literals; `127.evil.example` is a DNS name, not loopback. */
function isLoopbackName(host: string): boolean {
  return (
    host === "localhost" ||
    host === "::1" ||
    /^(::ffff:)?127(\.\d{1,3}){3}$/.test(host)
  );
}

function interfaceAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .map((entry) => entry.address.toLowerCase());
}

/**
 * Host-header allowlist against DNS rebinding: loopback names, the bound
 * address, the interface addresses when bound to a wildcard, the mobile HTTPS
 * hosts, the `network.publicUrl` host, the private tunnel host while it is on,
 * and `NERVE_ALLOWED_HOSTS`. Ports are ignored: only the name can be
 * attacker-controlled, and dev proxies forward their own port.
 */
export function createHostAllowlist(
  source: HostAllowlistSource,
  options: {
    env?: NodeJS.ProcessEnv;
    addresses?: () => string[];
  } = {},
): HostAllowlist {
  const configured = configuredHosts(options.env);
  const addresses = options.addresses ?? interfaceAddresses;
  return (hostHeader) => {
    if (!hostHeader) return false;
    const host = normalizeHostname(hostHeader);
    if (!host) return false;
    if (isLoopbackName(host)) return true;
    if (configured.includes(host)) return true;
    const publicHost = source.access?.publicHost;
    if (publicHost && normalizeHostname(publicHost) === host) return true;
    const tunnelHost = source.access?.tunnelHost;
    if (tunnelHost && normalizeHostname(tunnelHost) === host) return true;
    if (source.mobileHttps?.hosts.some((h) => normalizeHostname(h) === host))
      return true;
    if (isWildcardHost(source.host)) return addresses().includes(host);
    return normalizeHostname(source.host) === host;
  };
}

/**
 * The one Host decision for inbound requests (HTTP and WebSocket upgrade).
 * The tunnel listener answers only to the tunnel host, and to nothing while
 * the tunnel is off or its host is unknown; other listeners use the allowlist.
 */
export function isRequestHostAllowed(
  isAllowedHost: HostAllowlist,
  client: { host: string; viaTunnel: boolean },
  tunnelHost: string | undefined,
): boolean {
  if (!client.viaTunnel) return isAllowedHost(client.host);
  return (
    tunnelHost !== undefined &&
    normalizeHostname(tunnelHost) === normalizeHostname(client.host)
  );
}
