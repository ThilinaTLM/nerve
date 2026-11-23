import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PeerMatcher } from "../../infrastructure/network/client-address.js";
import { resolveClient, type GateRequest } from "./client-info.js";

const tunnelHost = "pc.tail1234.ts.net:8443";
const config = {
  trustedPeers: new PeerMatcher([]),
  tunnelOrigin: new URL(`https://${tunnelHost}`),
};

function request(overrides: Partial<GateRequest> = {}): GateRequest {
  return {
    method: "GET",
    url: new URL(`http://${tunnelHost}/api/status`),
    headers: new Headers({
      host: tunnelHost,
      "x-forwarded-for": "100.99.21.83",
      "x-forwarded-host": tunnelHost,
      "x-forwarded-proto": "https",
    }),
    peerAddress: "127.0.0.1",
    secureTransport: false,
    ...overrides,
  };
}

void describe("resolveClient on the tunnel listener", () => {
  void it("is a secure remote client with the tunnel origin, never local", () => {
    const client = resolveClient(request({ viaTunnel: true }), config);
    assert.equal(client.localEligible, false);
    assert.equal(client.secure, true);
    assert.equal(client.transportOk, true);
    assert.equal(client.origin, `https://${tunnelHost}`);
    assert.equal(client.host, tunnelHost);
    assert.equal(client.ip, "100.99.21.83");
  });

  void it("ignores the same headers on the main listener", () => {
    // A local process forging tunnel headers on the main port gains nothing.
    const client = resolveClient(request(), config);
    assert.equal(client.secure, false);
    assert.equal(client.transportOk, false);
    assert.equal(client.localEligible, false);
    assert.equal(client.ip, "127.0.0.1");
  });
});
