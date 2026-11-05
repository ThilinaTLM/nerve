import type { DaemonFile } from "@nervekit/contracts/status";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildShareEndpoints,
  buildShareUrls,
  firstLanIpv4Address,
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

  it("has no share endpoints without mobile HTTPS or on loopback binds", () => {
    assert.equal(buildShareEndpoints(daemonFile(), lanSnapshot), undefined);
    assert.equal(
      buildShareEndpoints(
        daemonFile({
          host: "127.0.0.1",
          mobileHttps: { port: 3748 },
        } as Partial<DaemonFile>),
        lanSnapshot,
      ),
      undefined,
    );
  });

  it("builds fragment-based pairing links without any long-lived token", () => {
    const endpoints = buildShareEndpoints(
      daemonFile({
        host: "192.168.1.20",
        mobileHttps: { port: 3748 },
      } as Partial<DaemonFile>),
      lanSnapshot,
    )!;
    assert.equal(
      endpoints.caCertUrl,
      "http://192.168.1.20:3747/nerve-local-ca.pem",
    );
    const urls = buildShareUrls(endpoints, { code: "ABCD-EFGH" });
    assert.equal(
      urls.secureShareUrl,
      "https://192.168.1.20:3748/#pair=ABCD-EFGH",
    );
    assert.equal(
      urls.mobileSetupUrl,
      "http://192.168.1.20:3747/mobile-setup#pair=ABCD-EFGH",
    );
    assert.doesNotMatch(JSON.stringify({ endpoints, urls }), /token/);
  });

  it("prefers the server's public pairing url for the app link", () => {
    const endpoints = buildShareEndpoints(
      daemonFile({
        host: "192.168.1.20",
        mobileHttps: { port: 3748 },
      } as Partial<DaemonFile>),
      lanSnapshot,
    )!;
    const urls = buildShareUrls(endpoints, {
      code: "ABCD-EFGH",
      url: "https://nerve.example.com/#pair=ABCD-EFGH",
    });
    assert.equal(
      urls.secureShareUrl,
      "https://nerve.example.com/#pair=ABCD-EFGH",
    );
  });
});
