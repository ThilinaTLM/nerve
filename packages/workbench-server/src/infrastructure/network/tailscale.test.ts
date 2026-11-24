import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractApprovalUrl,
  findServeEntry,
  funnelExposes,
  isPermissionDenied,
  locateTailscale,
  nodeProblem,
  parseTailscaleStatus,
} from "./tailscale.js";

const host = "pc.tail1234.ts.net";
const target = "http://127.0.0.1:47391";

void describe("tailscale status", () => {
  void it("reads the node name and certificate domains", () => {
    const node = parseTailscaleStatus({
      BackendState: "Running",
      Self: { DNSName: "PC.tail1234.ts.net." },
      CertDomains: [host],
    });
    assert.deepEqual(node, {
      running: true,
      dnsName: host,
      certDomains: [host],
    });
    assert.equal(nodeProblem(node), undefined);
  });

  void it("reports the first blocker", () => {
    assert.deepEqual(
      nodeProblem(parseTailscaleStatus({ BackendState: "Stopped" })),
      {
        code: "not_running",
      },
    );
    assert.deepEqual(
      nodeProblem(parseTailscaleStatus({ BackendState: "Running", Self: {} })),
      { code: "no_magic_dns" },
    );
    // CertDomains stays null until Serve/HTTPS is enabled for the tailnet.
    assert.deepEqual(
      nodeProblem(
        parseTailscaleStatus({
          BackendState: "Running",
          Self: { DNSName: `${host}.` },
          CertDomains: null,
        }),
      ),
      { code: "serve_not_enabled" },
    );
  });
});

void describe("tailscale serve output", () => {
  void it("extracts the approval link an unapproved serve waits on", () => {
    const output =
      "\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nf9RQXVpH821CNTRL\n\n";
    assert.equal(
      extractApprovalUrl(output),
      "https://login.tailscale.com/f/serve?node=nf9RQXVpH821CNTRL",
    );
    assert.equal(extractApprovalUrl("Serve started"), undefined);
  });

  void it("recognizes a missing operator permission", () => {
    assert.equal(
      isPermissionDenied(
        "sending serve config: Access denied: serve config denied",
      ),
      true,
    );
    assert.equal(isPermissionDenied("Serve started and running"), false);
  });
});

void describe("tailscale serve status", () => {
  const ours = {
    TCP: { "8443": { HTTPS: true } },
    Web: { [`${host}:8443`]: { Handlers: { "/": { Proxy: target } } } },
  };

  void it("finds our entry, someone else's, or none", () => {
    const input = { host, httpsPort: 8443, target };
    assert.deepEqual(findServeEntry({}, input), { kind: "absent" });
    assert.deepEqual(findServeEntry(ours, input), {
      kind: "ours",
      funnel: false,
    });
    assert.deepEqual(
      findServeEntry(ours, { ...input, target: "http://127.0.0.1:1" }),
      { kind: "other" },
    );
    // A raw TCP forward on the port is someone else's too.
    assert.deepEqual(
      findServeEntry(
        { TCP: { "8443": { TCPForward: "127.0.0.1:22" } } },
        input,
      ),
      { kind: "other" },
    );
  });

  void it("flags Funnel on our entry", () => {
    assert.deepEqual(
      findServeEntry(
        { ...ours, AllowFunnel: { [`${host}:8443`]: true } },
        { host, httpsPort: 8443, target },
      ),
      { kind: "ours", funnel: true },
    );
  });
});

void describe("stale entries and Funnel", () => {
  const entry = {
    TCP: { "8443": { HTTPS: true } },
    Web: {
      [`${host}:8443`]: {
        Handlers: { "/": { Proxy: "http://127.0.0.1:5000" } },
      },
    },
  };

  void it("recognizes the entry of the previously saved port as stale", () => {
    const input = { host, httpsPort: 8443, target };
    assert.deepEqual(
      findServeEntry(entry, {
        ...input,
        previousTarget: "http://127.0.0.1:5000",
      }),
      { kind: "stale" },
    );
    assert.deepEqual(findServeEntry(entry, input), { kind: "other" });
  });

  void it("finds Funnel on any entry that proxies to the target", () => {
    const json = {
      Web: {
        [`${host}:10000`]: { Handlers: { "/x": { Proxy: `${target}/` } } },
      },
      AllowFunnel: { [`${host}:10000`]: true },
    };
    assert.equal(funnelExposes(json, target), true);
    assert.equal(funnelExposes(json, "http://127.0.0.1:1"), false);
    assert.equal(funnelExposes({ ...json, AllowFunnel: {} }, target), false);
  });
});

void describe("locating the CLI", () => {
  void it("prefers PATH, then the platform's app location", async () => {
    const present = new Set([
      "/usr/bin/tailscale",
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    ]);
    const isExecutable = async (path: string) => present.has(path);
    assert.equal(
      await locateTailscale({
        platform: "linux",
        env: { PATH: "/opt/x:/usr/bin" },
        isExecutable,
      }),
      "/usr/bin/tailscale",
    );
    assert.equal(
      await locateTailscale({
        platform: "darwin",
        env: { PATH: "/opt/x" },
        isExecutable,
      }),
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    );
    assert.equal(
      await locateTailscale({
        platform: "linux",
        env: { PATH: "/opt/x" },
        isExecutable,
      }),
      undefined,
    );
  });
});
