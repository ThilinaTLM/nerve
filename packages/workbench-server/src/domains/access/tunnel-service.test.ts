import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TunnelStatus } from "@nervekit/contracts/access";
import type {
  ServeOutcome,
  TailscaleCli,
  TailscaleNode,
} from "../../infrastructure/network/tailscale.js";
import { TunnelService } from "./tunnel-service.js";

const host = "pc.tail1234.ts.net";

function fakeCli(options: {
  node?: TailscaleNode;
  serveResult?: ServeOutcome;
  serveStatus?: unknown;
}) {
  const calls: string[] = [];
  let served: { port: number; target: string } | undefined;
  const cli: TailscaleCli = {
    status: async () =>
      options.node ?? { running: true, dnsName: host, certDomains: [host] },
    serveStatus: async () =>
      options.serveStatus ??
      (served
        ? {
            TCP: { [served.port]: { HTTPS: true } },
            Web: {
              [`${host}:${served.port}`]: {
                Handlers: { "/": { Proxy: served.target } },
              },
            },
          }
        : {}),
    serve: async (port, target) => {
      calls.push(`serve ${port} ${target}`);
      const result = options.serveResult ?? { kind: "ok" };
      if (result.kind === "ok") served = { port, target };
      return result;
    },
    serveOff: async (port) => {
      calls.push(`off ${port}`);
      served = undefined;
      return { kind: "ok" };
    },
  };
  return { cli, calls };
}

function harness(cli: TailscaleCli | undefined) {
  const statuses: TunnelStatus[] = [];
  const events: string[] = [];
  let origin: URL | undefined;
  let saved: number | undefined;
  let warm: () => void = () => undefined;
  const warmed = new Promise<void>((resolve) => (warm = resolve));
  const service = new TunnelService({
    cli: async () => cli,
    openListener: async (port) => {
      events.push(`open ${port ?? "any"}`);
      return {
        port: port ?? 47_391,
        close: async () => void events.push("close"),
      };
    },
    saveListenerPort: async (port) => void (saved = port),
    warmUp: async () => {
      warm();
      return true;
    },
    setOrigin: (value) => void (origin = value),
    publish: (status) => void statuses.push(status),
  });
  return {
    service,
    statuses,
    events,
    origin: () => origin,
    saved: () => saved,
    warmed,
  };
}

void describe("TunnelService", () => {
  void it("adds the Serve entry, persists the port and becomes ready", async () => {
    const { cli, calls } = fakeCli({});
    const h = harness(cli);
    await h.service.apply({ enabled: true, httpsPort: 443 });
    await h.warmed;
    await Promise.resolve();
    assert.deepEqual(calls, ["serve 443 http://127.0.0.1:47391"]);
    assert.equal(h.saved(), 47_391);
    assert.equal(h.origin()?.origin, `https://${host}`);
    assert.deepEqual(
      h.statuses.map((s) => s.state),
      ["starting", "certificate", "ready"],
    );
  });

  void it("reuses its own entry after a restart instead of adding another", async () => {
    const { cli, calls } = fakeCli({
      serveStatus: {
        TCP: { "8443": { HTTPS: true } },
        Web: {
          [`${host}:8443`]: {
            Handlers: { "/": { Proxy: "http://127.0.0.1:5000" } },
          },
        },
      },
    });
    const h = harness(cli);
    await h.service.apply({
      enabled: true,
      httpsPort: 8443,
      listenerPort: 5000,
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(h.events, ["open 5000"]);
    assert.equal(h.origin()?.origin, `https://${host}:8443`);
  });

  void it("never touches someone else's entry on the port", async () => {
    const { cli, calls } = fakeCli({
      serveStatus: { TCP: { "443": { TCPForward: "127.0.0.1:22" } } },
    });
    const h = harness(cli);
    await h.service.apply({ enabled: true, httpsPort: 443 });
    assert.deepEqual(calls, []);
    assert.deepEqual(h.events, ["open any", "close"]);
    assert.deepEqual(h.service.status, {
      state: "problem",
      problem: { code: "port_in_use", httpsPort: 443 },
    });
    assert.equal(h.origin(), undefined);
  });

  void it("surfaces the approval link when Serve is not enabled", async () => {
    const approvalUrl = "https://login.tailscale.com/f/serve?node=abc";
    const { cli } = fakeCli({
      serveResult: {
        kind: "problem",
        problem: { code: "serve_not_enabled", approvalUrl },
      },
    });
    const h = harness(cli);
    await h.service.apply({ enabled: true, httpsPort: 443 });
    assert.deepEqual(h.service.status, {
      state: "problem",
      problem: { code: "serve_not_enabled", approvalUrl },
    });
  });

  void it("reports a missing CLI and a stopped daemon", async () => {
    const missing = harness(undefined);
    await missing.service.apply({ enabled: true, httpsPort: 443 });
    assert.deepEqual(missing.service.status, {
      state: "problem",
      problem: { code: "not_installed" },
    });
    const stopped = harness(
      fakeCli({ node: { running: false, certDomains: [] } }).cli,
    );
    await stopped.service.apply({ enabled: true, httpsPort: 443 });
    assert.deepEqual(stopped.service.status, {
      state: "problem",
      problem: { code: "not_running" },
    });
  });

  void it("removes only its own entry when turned off", async () => {
    const { cli, calls } = fakeCli({});
    const h = harness(cli);
    await h.service.apply({ enabled: true, httpsPort: 443 });
    await h.service.apply({ enabled: false, httpsPort: 443 });
    assert.deepEqual(calls, ["serve 443 http://127.0.0.1:47391", "off 443"]);
    assert.equal(h.events.at(-1), "close");
    assert.equal(h.origin(), undefined);
    assert.deepEqual(h.service.status, { state: "off" });
  });
});
