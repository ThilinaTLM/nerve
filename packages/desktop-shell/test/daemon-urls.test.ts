import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DaemonFile } from "@nervekit/contracts";
import {
  buildShareUrls,
  firstLanIpv4Address,
  isLoopbackHost,
  isPrivateIpv4,
  isVirtualInterface,
  isWildcardHost,
  localConnectUrl,
  normalizeRemoteDaemonUrl,
  type NetworkInterfacesSnapshot,
} from "../src/daemon/urls.ts";

function daemonFile(overrides: Partial<DaemonFile> = {}): DaemonFile {
  return {
    daemonId: "daemon_test",
    pid: 1234,
    host: "0.0.0.0",
    port: 3747,
    url: "http://0.0.0.0:3747",
    startedAt: "2026-07-17T00:00:00.000Z",
    dataDir: "/home/test/.nerve",
    version: "0.8.0",
    ...overrides,
  } as DaemonFile;
}

const lanSnapshot: NetworkInterfacesSnapshot = {
  lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
  docker0: [{ family: "IPv4", internal: false, address: "172.17.0.1" }],
  eth0: [{ family: "IPv4", internal: false, address: "192.168.1.20" }],
};

describe("daemon url policy", () => {
  it("normalizes remote urls to origins and rejects non-http protocols", () => {
    assert.equal(
      normalizeRemoteDaemonUrl("https://nerve.example.com:8443/some/path"),
      "https://nerve.example.com:8443",
    );
    assert.equal(
      normalizeRemoteDaemonUrl("http://10.0.0.5:3747"),
      "http://10.0.0.5:3747",
    );
    assert.throws(
      () => normalizeRemoteDaemonUrl("ws://example.com"),
      /http:\/\/ or https:\/\//,
    );
  });

  it("converts wildcard binds to loopback connect urls", () => {
    assert.equal(
      localConnectUrl("http://0.0.0.0:3747"),
      "http://127.0.0.1:3747",
    );
    assert.equal(
      localConnectUrl("http://127.0.0.1:3747/x"),
      "http://127.0.0.1:3747",
    );
    assert.equal(localConnectUrl("https://127.0.0.1:3747"), undefined);
    assert.equal(localConnectUrl("not a url"), undefined);
  });

  it("classifies loopback, wildcard, private, and virtual hosts", () => {
    assert.equal(isLoopbackHost("localhost"), true);
    assert.equal(isLoopbackHost("127.0.0.1"), true);
    assert.equal(isLoopbackHost("127.5.5.5"), true);
    assert.equal(isLoopbackHost("::1"), true);
    assert.equal(isLoopbackHost("192.168.1.5"), false);
    assert.equal(isWildcardHost("0.0.0.0"), true);
    assert.equal(isWildcardHost("::"), true);
    assert.equal(isWildcardHost("127.0.0.1"), false);
    assert.equal(isPrivateIpv4("10.1.2.3"), true);
    assert.equal(isPrivateIpv4("172.20.0.1"), true);
    assert.equal(isPrivateIpv4("192.168.0.1"), true);
    assert.equal(isPrivateIpv4("8.8.8.8"), false);
    assert.equal(isVirtualInterface("docker0"), true);
    assert.equal(isVirtualInterface("veth1234"), true);
    assert.equal(isVirtualInterface("eth0"), false);
  });

  it("prefers private physical interfaces deterministically for wildcard binds", () => {
    assert.equal(firstLanIpv4Address(lanSnapshot), "192.168.1.20");
    assert.equal(
      firstLanIpv4Address({
        docker0: [{ family: "IPv4", internal: false, address: "172.17.0.1" }],
      }),
      "172.17.0.1",
      "falls back to private virtual addresses",
    );
    assert.equal(
      firstLanIpv4Address({
        eth0: [{ family: "IPv4", internal: false, address: "203.0.113.9" }],
      }),
      "203.0.113.9",
      "falls back to public physical addresses",
    );
    assert.equal(firstLanIpv4Address({}), undefined);
  });

  it("builds HTTP share urls from wildcard binds using the LAN address", () => {
    const urls = buildShareUrls(daemonFile(), "tok_abc", lanSnapshot);
    assert.equal(urls.shareUrl, "http://192.168.1.20:3747/?token=tok_abc");
    assert.equal(urls.mobileSetupUrl, undefined);
    assert.equal(urls.secureShareUrl, undefined);
    assert.equal(urls.caCertUrl, undefined);
  });

  it("omits share urls for loopback binds", () => {
    const urls = buildShareUrls(
      daemonFile({ host: "127.0.0.1" }),
      "tok_abc",
      lanSnapshot,
    );
    assert.deepEqual(urls, {
      shareUrl: undefined,
      mobileSetupUrl: undefined,
      secureShareUrl: undefined,
      caCertUrl: undefined,
    });
  });

  it("builds mobile HTTPS setup, secure share, and CA urls when enabled", () => {
    const urls = buildShareUrls(
      daemonFile({
        host: "192.168.1.20",
        mobileHttps: { port: 3748 },
      } as Partial<DaemonFile>),
      "tok_abc",
      lanSnapshot,
    );
    assert.equal(urls.shareUrl, "http://192.168.1.20:3747/?token=tok_abc");
    assert.equal(
      urls.secureShareUrl,
      "https://192.168.1.20:3748/?token=tok_abc",
    );
    assert.equal(
      urls.mobileSetupUrl,
      "http://192.168.1.20:3747/mobile-setup?token=tok_abc",
    );
    assert.equal(urls.caCertUrl, "http://192.168.1.20:3747/nerve-local-ca.pem");
  });
});
