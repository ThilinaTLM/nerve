import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ToolExecutionError } from "../errors/tool-error.js";

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

const defaultResolver: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  );

export async function assertSafeHttpUrl(
  rawUrl: string | URL,
  options: {
    allowPrivateNetwork?: boolean;
    resolveHost?: HostResolver;
  } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl);
  } catch {
    throw new ToolExecutionError("WEB_FETCH_INVALID_URL", "URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ToolExecutionError(
      "WEB_FETCH_UNSUPPORTED_PROTOCOL",
      "Only HTTP and HTTPS URLs are supported.",
    );
  }
  if (url.username || url.password) {
    throw new ToolExecutionError(
      "WEB_FETCH_URL_CREDENTIALS_DENIED",
      "URLs containing credentials are not allowed.",
    );
  }
  if (options.allowPrivateNetwork) return url;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    throw privateNetworkError(url);
  }

  const addresses = isIP(hostname)
    ? [hostname]
    : await (options.resolveHost ?? defaultResolver)(hostname);
  if (addresses.length === 0 || addresses.some(isNonPublicAddress)) {
    throw privateNetworkError(url);
  }
  return url;
}

function privateNetworkError(url: URL): ToolExecutionError {
  return new ToolExecutionError(
    "WEB_FETCH_PRIVATE_NETWORK_DENIED",
    "Private, local, link-local, and metadata network destinations are blocked by host policy.",
    { origin: url.origin },
  );
}

export function isNonPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? address;
  const version = isIP(normalized);
  if (version === 4) return isNonPublicIpv4(normalized);
  if (version !== 6) return true;

  const mapped = normalized.match(/^::ffff:(.+)$/);
  if (mapped?.[1]) {
    if (mapped[1].includes(".")) return isNonPublicIpv4(mapped[1]);
    const [high, low] = mapped[1]
      .split(":")
      .map((part) => Number.parseInt(part || "0", 16));
    if (Number.isFinite(high) && Number.isFinite(low)) {
      return isNonPublicIpv4(
        `${(high! >> 8) & 0xff}.${high! & 0xff}.${(low! >> 8) & 0xff}.${low! & 0xff}`,
      );
    }
  }
  if (normalized === "::" || normalized === "::1") return true;
  const segments = normalized.split(":");
  const first = Number.parseInt(segments[0] || "0", 16);
  const second = Number.parseInt(segments[1] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    normalized.startsWith("2001:2:") ||
    normalized.startsWith("2001:db8:") ||
    (first === 0x3fff && second < 0x1000)
  );
}

function isNonPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) {
    return true;
  }
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 192 && b === 88 && octets[2] === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  );
}
