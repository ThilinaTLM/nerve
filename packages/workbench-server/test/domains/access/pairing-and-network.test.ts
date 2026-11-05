import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PeerMatcher } from "../../../src/infrastructure/network/client-address.js";
import { resolveClient } from "../../../src/domains/access/client-info.js";
import { FailureLimiter } from "../../../src/domains/access/failure-limiter.js";
import { PairingCodes } from "../../../src/domains/access/pairing-codes.js";

describe("PairingCodes", () => {
  it("is single use, case/separator/lookalike tolerant and expires", () => {
    const clock = { now: 0 };
    const codes = new PairingCodes({ now: () => clock.now });
    const { code } = codes.create("mobile", 120);
    assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.deepEqual(
      codes.redeem(code.toLowerCase().replace("-", " "), "1.1.1.1", "pairing"),
      { ok: true, purpose: "mobile" },
    );
    assert.deepEqual(codes.redeem(code, "1.1.1.1", "pairing"), {
      ok: false,
      reason: "invalid",
    });
    const second = codes.create("browser", 30);
    clock.now = 30_000;
    assert.deepEqual(codes.redeem(second.code, "1.1.1.1", "pairing"), {
      ok: false,
      reason: "invalid",
    });
  });

  it("kills a live code after five wrong guesses", () => {
    const codes = new PairingCodes();
    const { code } = codes.create("mobile", 120);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(
        codes.redeem(`BAD${i}-0000`, `10.0.0.${i}`, "pairing").ok,
        false,
      );
    }
    assert.deepEqual(codes.redeem(code, "10.0.0.99", "pairing"), {
      ok: false,
      reason: "invalid",
    });
  });

  it("limits failures per IP with backoff and a Retry-After", () => {
    const clock = { now: 0 };
    const codes = new PairingCodes({ now: () => clock.now });
    for (let i = 0; i < 10; i += 1)
      codes.redeem("NOPE-NOPE", "9.9.9.9", "pairing");
    const { code } = codes.create("mobile", 120);
    const blocked = codes.redeem(code, "9.9.9.9", "pairing");
    assert.equal(blocked.ok === false && blocked.reason, "rate_limited");
    assert.ok(
      blocked.ok === false &&
        blocked.reason === "rate_limited" &&
        blocked.retryAfterSeconds > 0,
    );
    // Another address is not blocked by the per-IP limit.
    assert.equal(codes.redeem(code, "8.8.8.8", "pairing").ok, true);
  });

  it("keeps setup codes out of the pairing path and vice versa", () => {
    const codes = new PairingCodes();
    const setup = codes.create("setup", 600);
    const pair = codes.create("mobile", 120);
    assert.equal(codes.redeem(setup.code, "1.1.1.1", "pairing").ok, false);
    assert.equal(codes.peek(pair.code, "1.1.1.1", "setup").ok, false);
    assert.equal(codes.peek(setup.code, "1.1.1.1", "setup").ok, true);
    assert.equal(codes.consume(setup.code), true);
    assert.equal(codes.consume(setup.code), false);
  });
});

describe("FailureLimiter", () => {
  it("doubles the lockout on repeated strikes", () => {
    const clock = { now: 0 };
    const limiter = new FailureLimiter({
      perKey: 2,
      global: 100,
      windowMs: 1000,
      baseBlockMs: 1000,
      now: () => clock.now,
    });
    limiter.recordFailure("a");
    limiter.recordFailure("a");
    assert.deepEqual(limiter.check("a"), {
      allowed: false,
      retryAfterSeconds: 1,
    });
    clock.now = 1001;
    assert.equal(limiter.check("a").allowed, true);
    limiter.recordFailure("a");
    limiter.recordFailure("a");
    assert.deepEqual(limiter.check("a"), {
      allowed: false,
      retryAfterSeconds: 2,
    });
  });
});

describe("trusted proxy resolution", () => {
  const request = (peer: string, headers: Record<string, string>) => ({
    method: "GET",
    url: new URL("http://127.0.0.1:43967/api/x"),
    headers: new Headers(headers),
    peerAddress: peer,
    secureTransport: false,
  });
  const publicUrl = new URL("https://nerve.example.com");

  it("matches addresses and CIDR ranges, IPv4 and IPv6", () => {
    const peers = new PeerMatcher([
      "127.0.0.1",
      "::1",
      "172.17.0.0/16",
      "fd00::/8",
    ]);
    assert.ok(peers.matches("127.0.0.1"));
    assert.ok(peers.matches("::ffff:127.0.0.1"));
    assert.ok(peers.matches("172.17.4.9"));
    assert.ok(!peers.matches("172.18.0.1"));
    assert.ok(peers.matches("fd12::5"));
    assert.ok(!peers.matches("fe80::1"));
    assert.throws(() => new PeerMatcher(["10.0.0.0/33"]));
    assert.throws(() => new PeerMatcher(["not-an-ip"]));
  });

  it("honors forwarded headers only from trusted peers and only with a publicUrl", () => {
    const trustedPeers = new PeerMatcher(["172.17.0.0/16"]);
    const headers = {
      "x-forwarded-for": "203.0.113.7",
      "x-forwarded-proto": "https",
      host: "nerve.example.com",
    };
    const viaProxy = resolveClient(request("172.17.0.2", headers), {
      publicUrl,
      trustedPeers,
    });
    assert.equal(viaProxy.ip, "203.0.113.7");
    assert.ok(
      viaProxy.secure && viaProxy.transportOk && viaProxy.viaTrustedProxy,
    );
    assert.equal(viaProxy.origin, "https://nerve.example.com");
    assert.ok(!viaProxy.localEligible);

    const stranger = resolveClient(request("198.51.100.4", headers), {
      publicUrl,
      trustedPeers,
    });
    assert.equal(stranger.ip, "198.51.100.4");
    assert.ok(
      !stranger.secure && !stranger.transportOk && !stranger.viaTrustedProxy,
    );

    const noPublicUrl = resolveClient(request("172.17.0.2", headers), {
      trustedPeers,
    });
    assert.ok(!noPublicUrl.viaTrustedProxy && !noPublicUrl.secure);
  });

  it("walks X-Forwarded-For from the right past trusted hops", () => {
    const trustedPeers = new PeerMatcher(["10.0.0.0/8"]);
    const client = resolveClient(
      request("10.0.0.2", {
        "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.9",
        "x-forwarded-proto": "https",
      }),
      { publicUrl, trustedPeers },
    );
    assert.equal(client.ip, "203.0.113.7");
  });

  it("denies the local credential whenever anything forwards", () => {
    const trustedPeers = new PeerMatcher(["127.0.0.1"]);
    const plain = resolveClient(
      request("127.0.0.1", { host: "127.0.0.1:43967" }),
      { trustedPeers },
    );
    assert.ok(plain.localEligible);
    const forwarded = resolveClient(
      request("127.0.0.1", {
        host: "127.0.0.1:43967",
        "x-forwarded-for": "1.2.3.4",
      }),
      { trustedPeers },
    );
    assert.ok(!forwarded.localEligible && !forwarded.transportOk);
    const rebinding = resolveClient(
      request("127.0.0.1", { host: "evil.example" }),
      { trustedPeers },
    );
    assert.ok(!rebinding.localEligible);
  });
});
