import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { IncomingMessage } from "node:http";
import type { GateRequest } from "../../domains/access/client-info.js";

/** TCP peer of an in-flight request; empty when the runtime exposes none (never treated as loopback). */
export function peerAddressOf(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "";
  } catch {
    return "";
  }
}

export function gateRequestFromContext(c: Context): GateRequest {
  const url = new URL(c.req.url);
  return {
    method: c.req.method,
    url,
    headers: c.req.raw.headers,
    peerAddress: peerAddressOf(c),
    secureTransport: url.protocol === "https:",
  };
}

export function gateRequestFromUpgrade(request: IncomingMessage): GateRequest {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value))
      for (const entry of value) headers.append(name, entry);
    else if (value !== undefined) headers.set(name, value);
  }
  const secureTransport = Boolean(
    (request.socket as { encrypted?: boolean }).encrypted,
  );
  const host = request.headers.host ?? "localhost";
  return {
    method: request.method ?? "GET",
    url: new URL(
      request.url ?? "/",
      `${secureTransport ? "https" : "http"}://${host}`,
    ),
    headers,
    peerAddress: request.socket.remoteAddress ?? "",
    secureTransport,
  };
}
