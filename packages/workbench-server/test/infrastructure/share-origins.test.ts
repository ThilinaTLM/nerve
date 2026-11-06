import assert from "node:assert/strict";
import test from "node:test";
import { listShareOrigins } from "../../src/infrastructure/network/share-origins.js";

const ipv4 = (address: string) => ({
  family: "IPv4",
  internal: false,
  address,
});

const interfaces = {
  lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
  tailscale0: [ipv4("100.101.2.3")],
  docker0: [ipv4("172.17.0.1")],
  wlan0: [ipv4("192.168.1.20")],
  eth0: [ipv4("10.0.0.5")],
  wg0: [ipv4("10.8.0.2")],
};
const certifiedHosts = [
  "192.168.1.20",
  "10.0.0.5",
  "10.8.0.2",
  "100.101.2.3",
  "172.17.0.1",
  "localhost",
  "127.0.0.1",
];

test("lists one origin per reachable network, local first, bridges skipped", () => {
  assert.deepEqual(
    listShareOrigins({
      boundHost: "0.0.0.0",
      httpPort: 3747,
      httpsPort: 3748,
      certifiedHosts,
      interfaces,
    }),
    [
      {
        kind: "lan",
        label: "Local network (wlan0)",
        origin: "https://192.168.1.20:3748",
        setupOrigin: "http://192.168.1.20:3747",
      },
      {
        kind: "lan",
        label: "Local network (eth0)",
        origin: "https://10.0.0.5:3748",
        setupOrigin: "http://10.0.0.5:3747",
      },
      {
        kind: "tailscale",
        label: "Tailscale",
        origin: "https://100.101.2.3:3748",
        setupOrigin: "http://100.101.2.3:3747",
      },
      {
        kind: "vpn",
        label: "VPN",
        origin: "https://10.8.0.2:3748",
        setupOrigin: "http://10.8.0.2:3747",
      },
    ],
  );
});

test("omits addresses the certificate does not cover yet", () => {
  const origins = listShareOrigins({
    boundHost: "0.0.0.0",
    httpPort: 3747,
    httpsPort: 3748,
    certifiedHosts: ["192.168.1.20", "localhost", "127.0.0.1"],
    interfaces,
  });
  assert.deepEqual(
    origins.map((origin) => origin.label),
    ["Local network"],
  );
});

test("a specific bind offers only that address; loopback offers none", () => {
  assert.deepEqual(
    listShareOrigins({
      boundHost: "100.101.2.3",
      httpPort: 3747,
      httpsPort: 3748,
      certifiedHosts,
      interfaces,
    }).map((origin) => origin.origin),
    ["https://100.101.2.3:3748"],
  );
  assert.deepEqual(
    listShareOrigins({
      boundHost: "127.0.0.1",
      httpPort: 3747,
      httpsPort: 3748,
      certifiedHosts,
      interfaces,
    }),
    [],
  );
});
