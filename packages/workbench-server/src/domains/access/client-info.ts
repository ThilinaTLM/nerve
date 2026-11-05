import { normalizeHostname } from "../../adapters/http/host-allowlist.js";
import {
  isLoopbackAddress,
  normalizeAddress,
  type PeerMatcher,
} from "../../infrastructure/network/client-address.js";

/** Transport-neutral view of one inbound HTTP request or WebSocket upgrade. */
export interface GateRequest {
  method: string;
  url: URL;
  headers: Headers;
  /** TCP peer address (socket remote). */
  peerAddress: string;
  /** TLS terminated by this process. */
  secureTransport: boolean;
}

export interface ClientInfo {
  /** Client address as seen by the daemon, or by the trusted proxy. */
  ip: string;
  /** TCP peer is loopback. */
  loopbackPeer: boolean;
  /** Any forwarding header present (trusted or not). */
  forwarded: boolean;
  /** Peer is in `trustProxy.peers` and `publicUrl` is set: forwarded headers were honored. */
  viaTrustedProxy: boolean;
  /** TLS here, or a trusted proxy reported https. */
  secure: boolean;
  /** Effective Host (X-Forwarded-Host only from a trusted proxy). */
  host: string;
  /** Origin browsers see for this request (`publicUrl` origin behind a trusted proxy). */
  origin: string;
  /**
   * Device credentials may travel here: TLS, or a plain loopback connection
   * with nobody forwarding on someone's behalf.
   */
  transportOk: boolean;
  /** Eligible for the local (tier 1) credential: loopback peer + host, no forwarding. */
  localEligible: boolean;
}

export interface ClientResolution {
  publicUrl?: URL;
  trustedPeers: PeerMatcher;
}

const FORWARDING_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "forwarded",
];

function first(value: string | null): string {
  return value?.split(",")[0]?.trim() ?? "";
}

/** Rightmost address in the chain that is not itself a trusted proxy. */
function forwardedClient(
  chain: string,
  peerAddress: string,
  trusted: PeerMatcher,
): string {
  const hops = chain
    .split(",")
    .map((entry) => normalizeAddress(entry))
    .filter(Boolean);
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index];
    if (hop && !trusted.matches(hop)) return hop;
  }
  return hops[0] ?? normalizeAddress(peerAddress);
}

export function resolveClient(
  request: GateRequest,
  config: ClientResolution,
): ClientInfo {
  const { headers } = request;
  const peer = normalizeAddress(request.peerAddress);
  const forwarded = FORWARDING_HEADERS.some((name) => headers.has(name));
  const viaTrustedProxy =
    config.publicUrl !== undefined && config.trustedPeers.matches(peer);
  const loopbackPeer = isLoopbackAddress(peer);

  const ip = viaTrustedProxy
    ? forwardedClient(
        headers.get("x-forwarded-for") ?? "",
        peer,
        config.trustedPeers,
      ) || peer
    : peer;
  const proto = viaTrustedProxy
    ? first(headers.get("x-forwarded-proto")).toLowerCase()
    : "";
  const secure = request.secureTransport || proto === "https";
  const host = viaTrustedProxy
    ? first(headers.get("x-forwarded-host")) || (headers.get("host") ?? "")
    : (headers.get("host") ?? request.url.host);
  const origin =
    viaTrustedProxy && config.publicUrl
      ? config.publicUrl.origin
      : `${request.secureTransport ? "https" : request.url.protocol.replace(":", "")}://${headers.get("host") ?? request.url.host}`;

  const hostName = normalizeHostname(host);
  const loopbackHost = hostName === "localhost" || isLoopbackAddress(hostName);
  return {
    ip,
    loopbackPeer,
    forwarded,
    viaTrustedProxy,
    secure,
    host,
    origin,
    transportOk: secure || (loopbackPeer && !forwarded),
    localEligible: loopbackPeer && loopbackHost && !forwarded,
  };
}
