import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeHttpUrl,
  isNonPublicAddress,
} from "../src/execution/common/network-policy.js";

describe("web fetch network policy", () => {
  it("allows public HTTP destinations", async () => {
    const url = await assertSafeHttpUrl("https://example.com/path", {
      resolveHost: async () => ["93.184.216.34"],
    });
    assert.equal(url.hostname, "example.com");
  });

  it("blocks local names, private DNS answers, and metadata addresses", async () => {
    await assert.rejects(
      assertSafeHttpUrl("http://localhost:3000"),
      /Private, local, link-local/,
    );
    await assert.rejects(
      assertSafeHttpUrl("https://public.example", {
        resolveHost: async () => ["10.0.0.8"],
      }),
      /Private, local, link-local/,
    );
    await assert.rejects(
      assertSafeHttpUrl("http://169.254.169.254/latest/meta-data"),
      /Private, local, link-local/,
    );
  });

  it("allows trusted hosts to opt into private development access", async () => {
    const url = await assertSafeHttpUrl("http://127.0.0.1:3747", {
      allowPrivateNetwork: true,
    });
    assert.equal(url.port, "3747");
  });

  it("classifies representative IPv4 and IPv6 special ranges", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "2001:db8::1",
      "3fff::1",
    ]) {
      assert.equal(isNonPublicAddress(address), true, address);
    }
    assert.equal(isNonPublicAddress("1.1.1.1"), false);
    assert.equal(isNonPublicAddress("2606:4700:4700::1111"), false);
  });
});
