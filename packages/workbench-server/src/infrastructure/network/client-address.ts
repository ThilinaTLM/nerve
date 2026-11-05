import { BlockList, isIP } from "node:net";

/** Strip IPv4-mapped IPv6 and zone ids so one literal matches one rule family. */
export function normalizeAddress(address: string | undefined): string {
  if (!address) return "";
  let value = address.trim().toLowerCase();
  if (value.startsWith("[") && value.includes("]"))
    value = value.slice(1, value.indexOf("]"));
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  return mapped?.[1] ?? value;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  const value = normalizeAddress(address);
  return value === "::1" || /^127(\.\d{1,3}){3}$/.test(value);
}

/**
 * Proxy peer allowlist: single addresses and CIDR ranges, IPv4 and IPv6.
 * There is deliberately no "trust the first hop" mode.
 */
export class PeerMatcher {
  readonly #list = new BlockList();
  readonly specs: readonly string[];

  constructor(specs: readonly string[]) {
    this.specs = specs;
    for (const raw of specs) {
      const spec = raw.trim();
      const [address, prefix, ...rest] = spec.split("/");
      const normalized = normalizeAddress(address);
      const family = isIP(normalized);
      if (rest.length > 0 || family === 0) {
        throw new Error(`Invalid trusted proxy peer: ${JSON.stringify(raw)}`);
      }
      const type = family === 4 ? "ipv4" : "ipv6";
      if (prefix === undefined) {
        this.#list.addAddress(normalized, type);
        continue;
      }
      const bits = Number(prefix);
      const max = family === 4 ? 32 : 128;
      if (!/^\d+$/.test(prefix) || bits > max) {
        throw new Error(`Invalid trusted proxy peer: ${JSON.stringify(raw)}`);
      }
      this.#list.addSubnet(normalized, bits, type);
    }
  }

  matches(address: string | undefined): boolean {
    const value = normalizeAddress(address);
    const family = isIP(value);
    if (family === 0) return false;
    return this.#list.check(value, family === 4 ? "ipv4" : "ipv6");
  }
}
