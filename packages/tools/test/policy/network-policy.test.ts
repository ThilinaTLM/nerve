import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import {
  assertSafeHttpUrl,
  createPinnedFetch,
  createPinnedLookup,
  isNonPublicAddress,
} from "../../src/execution/network/network-policy.js";

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

  it("blocks IPv6 forms embedding private IPv4 and special ranges", () => {
    for (const address of [
      "64:ff9b::7f00:1",
      "64:ff9b::10.0.0.1",
      "64:ff9b:1::1",
      "64:ff9b:1:abcd::1",
      "2002:7f00:1::1",
      "2002:c0a8:101::",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2",
      "::10.0.0.1",
      "::7f00:1",
      "::",
      "0.1.2.3",
      "169.254.1.1",
      "ff02::1",
      "fd12::1",
      "febf::1",
    ]) {
      assert.equal(isNonPublicAddress(address), true, address);
    }
    for (const address of [
      "64:ff9b::808:808",
      "2002:808:808::1",
      "::ffff:8.8.8.8",
      "2606:4700:4700::1111",
    ]) {
      assert.equal(isNonPublicAddress(address), false, address);
    }
  });
});

describe("pinned fetch", () => {
  async function withServer(
    run: (port: number, hits: () => number) => Promise<void>,
  ) {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.end("secret");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      await run((server.address() as AddressInfo).port, () => hits);
    } finally {
      server.close();
    }
  }

  it("rejects a lookup that returns a private address at connect time", async () => {
    await withServer(async (port, hits) => {
      const pinned = createPinnedFetch(async () => ["127.0.0.1"]);
      await assert.rejects(
        pinned(`http://public.example:${port}/`),
        /Private, local, link-local/,
      );
      assert.equal(hits(), 0);
    });
  });

  it("cannot be rebound to a private address after the first check", async () => {
    await withServer(async (port, hits) => {
      let calls = 0;
      const resolveHost = async () => (calls++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]);
      const url = await assertSafeHttpUrl(`http://rebind.example:${port}/`, {
        resolveHost,
      });
      await assert.rejects(
        createPinnedFetch(resolveHost)(url, { signal: AbortSignal.timeout(2000) }),
        /Private, local, link-local/,
      );
      assert.equal(hits(), 0);
    });
  });

  it("returns the single vetted public address from the lookup", async () => {
    const lookup = createPinnedLookup(async () => ["93.184.216.34"]) as (
      host: string,
      options: object,
      cb: (err: unknown, address?: unknown, family?: number) => void,
    ) => void;
    const [single, all] = await Promise.all([
      new Promise((resolve) => lookup("a.example", {}, (_e, a, f) => resolve([a, f]))),
      new Promise((resolve) => lookup("a.example", { all: true }, (_e, a) => resolve(a))),
    ]);
    assert.deepEqual(single, ["93.184.216.34", 4]);
    assert.deepEqual(all, [{ address: "93.184.216.34", family: 4 }]);
  });
});
