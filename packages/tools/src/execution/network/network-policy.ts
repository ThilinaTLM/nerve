import { lookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
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

  // IPv6 literals keep their brackets in URL.hostname ("[::1]").
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "");
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

  const groups = parseIpv6(normalized);
  if (!groups) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] =
    groups;
  const v4 = (high: number, low: number) =>
    isNonPublicIpv4(
      `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`,
    );
  // ::, ::1, IPv4-compatible ::/96 and IPv4-mapped ::ffff:0:0/96.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0 && g6 === 0 && g7 <= 1) return true;
    if (g5 === 0xffff || g5 === 0) return v4(g6, g7);
  }
  // NAT64 64:ff9b::/96 (embedded v4) and local-use 64:ff9b:1::/48.
  if (g0 === 0x64 && g1 === 0xff9b) {
    if (g2 === 1) return true;
    if (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return v4(g6, g7);
  }
  // 6to4 2002::/16 embeds the v4 address in bits 16-47.
  if (g0 === 0x2002) return v4(g1, g2);
  // Teredo 2001::/32 (embeds server and obfuscated client v4).
  if (g0 === 0x2001 && g1 === 0) return true;
  return (
    (g0 & 0xfe00) === 0xfc00 ||
    (g0 & 0xffc0) === 0xfe80 ||
    (g0 & 0xff00) === 0xff00 ||
    (g0 === 0x2001 && g1 === 2) ||
    (g0 === 0x2001 && g1 === 0xdb8) ||
    (g0 === 0x3fff && g1 < 0x1000)
  );
}

function parseIpv6(address: string): number[] | undefined {
  let text = address;
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1] && dotted[2]) {
    const o = dotted[2].split(".").map(Number);
    if (o.some((n) => n > 255)) return undefined;
    text = `${dotted[1]}${(((o[0] ?? 0) << 8) | (o[1] ?? 0)).toString(16)}:${(((o[2] ?? 0) << 8) | (o[3] ?? 0)).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return undefined;
  const parts = [...head, ...Array<string>(fill).fill("0"), ...tail];
  const groups = parts.map((part) => Number.parseInt(part, 16));
  return groups.length === 8 && groups.every(Number.isFinite)
    ? groups
    : undefined;
}

/**
 * Resolves once, rejects non-public answers, and returns the vetted address so
 * the connection uses exactly the IP that was checked (no DNS rebinding window).
 */
export function createPinnedLookup(
  resolveHost: HostResolver = defaultResolver,
): NonNullable<RequestOptions["lookup"]> {
  return ((
    hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (...args: unknown[]) => void,
  ) => {
    const all = typeof options === "object" && options?.all === true;
    resolveHost(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some(isNonPublicAddress)) {
          callback(
            new ToolExecutionError(
              "WEB_FETCH_PRIVATE_NETWORK_DENIED",
              "Private, local, link-local, and metadata network destinations are blocked by host policy.",
              { hostname },
            ),
          );
          return;
        }
        const entries = addresses.map((address) => ({
          address,
          family: isIP(address),
        }));
        if (all) callback(null, entries);
        else callback(null, entries[0]?.address, entries[0]?.family);
      },
      (error: unknown) => callback(error),
    );
  }) as NonNullable<RequestOptions["lookup"]>;
}

/** Fetch whose socket connects only to the vetted, pinned address. A request body must be a string or bytes. */
export function createPinnedFetch(resolveHost?: HostResolver): typeof fetch {
  const lookup = createPinnedLookup(resolveHost);
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    return await new Promise<Response>((resolve, reject) => {
      const req = request(
        url,
        {
          method: init?.method ?? "GET",
          headers,
          lookup,
          signal: init?.signal ?? undefined,
        },
        (res) => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            for (const v of Array.isArray(value) ? value : [value]) {
              if (v !== undefined) responseHeaders.append(key, v);
            }
          }
          const status = res.statusCode ?? 502;
          const nullBody = [101, 204, 205, 304].includes(status);
          if (nullBody) res.resume();
          resolve(
            new Response(
              nullBody ? null : (Readable.toWeb(res) as ReadableStream),
              {
                status,
                statusText: res.statusMessage,
                headers: responseHeaders,
              },
            ),
          );
        },
      );
      req.on("error", reject);
      const body = init?.body;
      if (body === undefined || body === null) req.end();
      else if (typeof body === "string" || ArrayBuffer.isView(body))
        req.end(body);
      else {
        req.destroy();
        reject(new TypeError("A pinned fetch body must be a string or bytes."));
      }
    });
  };
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
