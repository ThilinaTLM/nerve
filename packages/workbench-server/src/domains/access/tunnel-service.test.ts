import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TunnelStatus } from "@nervekit/contracts/access";
import type {
  ServeOutcome,
  TailscaleCli,
  TailscaleNode,
} from "../../infrastructure/network/tailscale.js";
import { TunnelService, type TunnelServiceDeps } from "./tunnel-service.js";

const host = "pc.tail1234.ts.net";

function fakeCli(options: {
  node?: TailscaleNode;
  serveResult?: ServeOutcome;
  serveStatus?: unknown;
  /** An entry already present, e.g. left by a crashed run. */
  initial?: { port: number; target: string };
  serveOffResult?: ServeOutcome;
}) {
  const calls: string[] = [];
  const state = {
    served: options.initial,
    funnel: false,
  };
  const cli: TailscaleCli = {
    status: async () =>
      options.node ?? { running: true, dnsName: host, certDomains: [host] },
    serveStatus: async () => {
      const served = state.served;
      return (
        options.serveStatus ??
        (served
          ? {
              TCP: { [served.port]: { HTTPS: true } },
              Web: {
                [`${host}:${served.port}`]: {
                  Handlers: { "/": { Proxy: served.target } },
                },
              },
              AllowFunnel: state.funnel
                ? { [`${host}:${served.port}`]: true }
                : {},
            }
          : {})
      );
    },
    serve: async (port, target) => {
      calls.push(`serve ${port} ${target}`);
      const result = options.serveResult ?? { kind: "ok" };
      if (result.kind === "ok") state.served = { port, target };
      return result;
    },
    serveOff: async (port) => {
      calls.push(`off ${port}`);
      const result = options.serveOffResult ?? { kind: "ok" };
      if (result.kind === "ok") state.served = undefined;
      return result;
    },
  };
  return { cli, calls, state };
}

function harness(
  cli: TailscaleCli | undefined,
  overrides: Partial<TunnelServiceDeps> = {},
) {
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
    ...overrides,
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

  void it("removes the entry on clean shutdown, closing the listener first", async () => {
    const { cli, calls, state } = fakeCli({});
    const h = harness(cli);
    await h.service.apply({ enabled: true, httpsPort: 443 });
    await h.service.close();
    assert.deepEqual(calls, ["serve 443 http://127.0.0.1:47391", "off 443"]);
    assert.equal(state.served, undefined);
    assert.equal(h.events.at(-1), "close");
    assert.equal(h.origin(), undefined);
  });

  void it("replaces its own stale entry after a port fallback", async () => {
    // A crashed run served port 5000; it is taken now, so the listener moves.
    const { cli, calls } = fakeCli({
      initial: { port: 443, target: "http://127.0.0.1:5000" },
    });
    const h = harness(cli, {
      openListener: async () => ({ port: 5001, close: async () => undefined }),
    });
    await h.service.apply({
      enabled: true,
      httpsPort: 443,
      listenerPort: 5000,
    });
    assert.deepEqual(calls, ["off 443", "serve 443 http://127.0.0.1:5001"]);
    assert.equal(h.saved(), 5001);
    assert.notEqual(h.service.status.state, "problem");
  });

  void it("reports a failed removal on Off instead of off", async () => {
    const { cli } = fakeCli({
      serveOffResult: {
        kind: "problem",
        problem: { code: "command_failed", detail: "boom" },
      },
    });
    const h = harness(cli);
    await h.service.apply({ enabled: true, httpsPort: 443 });
    await h.service.apply({ enabled: false, httpsPort: 443 });
    assert.deepEqual(h.service.status, {
      state: "problem",
      problem: { code: "command_failed", detail: "boom" },
    });
    assert.equal(h.origin(), undefined);
  });

  void it("moves to another HTTPS port by removing the old entry first", async () => {
    const { cli, calls } = fakeCli({});
    const h = harness(cli);
    await h.service.apply({ enabled: true, httpsPort: 443 });
    await h.service.apply({ enabled: true, httpsPort: 8443 });
    assert.deepEqual(calls, [
      "serve 443 http://127.0.0.1:47391",
      "off 443",
      "serve 8443 http://127.0.0.1:47391",
    ]);
    assert.equal(h.origin()?.origin, `https://${host}:8443`);
  });

  void it("never publishes ready after Off or a port change during warm-up", async () => {
    for (const next of [
      { enabled: false, httpsPort: 443 as const },
      { enabled: true, httpsPort: 8443 as const },
    ]) {
      let release: (ready: boolean) => void = () => undefined;
      let first = true;
      const h = harness(fakeCli({}).cli, {
        warmUp: () =>
          first
            ? ((first = false),
              new Promise<boolean>((resolve) => (release = resolve)))
            : new Promise<boolean>(() => undefined),
      });
      await h.service.apply({ enabled: true, httpsPort: 443 });
      await h.service.apply(next);
      release(true);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        h.statuses.some((s) => s.state === "ready"),
        false,
      );
    }
  });

  void it("ignores the same settings while ready", async () => {
    const h = harness(fakeCli({}).cli);
    await h.service.apply({ enabled: true, httpsPort: 443 });
    await h.warmed;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.service.status.state, "ready");
    const before = h.events.length;
    await h.service.apply({ enabled: true, httpsPort: 443 });
    assert.equal(h.events.length, before);
  });

  void it("retries the same settings once the problem is gone", async () => {
    let running = false;
    const base = fakeCli({});
    const cli: TailscaleCli = {
      ...base.cli,
      status: async () => ({ running, dnsName: host, certDomains: [host] }),
    };
    const h = harness(cli);
    await h.service.apply({ enabled: true, httpsPort: 443 });
    assert.equal(h.service.status.state, "problem");
    running = true;
    await h.service.apply({ enabled: true, httpsPort: 443 });
    assert.notEqual(h.service.status.state, "problem");
  });

  void it("turns a late certificate timeout into a problem and stays up", async () => {
    const h = harness(fakeCli({}).cli, { warmUp: async () => false });
    await h.service.apply({ enabled: true, httpsPort: 443 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.service.status, {
      state: "problem",
      problem: {
        code: "command_failed",
        detail: "Tailscale could not get a certificate",
      },
    });
    assert.notEqual(h.origin(), undefined);
  });

  void it("refuses and cleans up when Funnel is on at start", async () => {
    const { cli, state } = fakeCli({
      initial: { port: 443, target: "http://127.0.0.1:47391" },
    });
    state.funnel = true;
    const h = harness(cli, {
      openListener: async () => ({
        port: 47_391,
        close: async () => undefined,
      }),
    });
    await h.service.apply({
      enabled: true,
      httpsPort: 443,
      listenerPort: 47_391,
    });
    assert.deepEqual(h.service.status, {
      state: "problem",
      problem: { code: "funnel_enabled", httpsPort: 443 },
    });
    assert.equal(h.origin(), undefined);
    assert.equal(state.served, undefined);
  });

  void it("ends in a problem, closing the listener, when opening or saving fails", async () => {
    const opening = harness(fakeCli({}).cli, {
      openListener: async () => {
        throw new Error("EADDRINUSE");
      },
    });
    await assert.doesNotReject(
      opening.service.apply({ enabled: true, httpsPort: 443 }),
    );
    assert.equal(opening.service.status.state, "problem");

    const saving = harness(fakeCli({}).cli, {
      saveListenerPort: async () => {
        throw new Error("disk full");
      },
    });
    await assert.doesNotReject(
      saving.service.apply({ enabled: true, httpsPort: 443 }),
    );
    assert.equal(saving.service.status.state, "problem");
    assert.equal(saving.events.at(-1), "close");
    assert.equal(saving.origin(), undefined);
  });

  void describe("while active", () => {
    async function waitFor(check: () => boolean) {
      for (let i = 0; i < 200 && !check(); i += 1)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(check(), true);
    }

    void it("closes when Funnel appears on our target", async () => {
      const { cli, state } = fakeCli({});
      const h = harness(cli, { driftIntervalMs: 5 });
      await h.service.apply({ enabled: true, httpsPort: 443 });
      state.funnel = true;
      await waitFor(() => h.service.status.state === "problem");
      assert.deepEqual(h.service.status, {
        state: "problem",
        problem: { code: "funnel_enabled", httpsPort: 443 },
      });
      assert.equal(h.origin(), undefined);
      assert.equal(h.events.at(-1), "close");
      assert.equal(state.served, undefined);
    });

    void it("closes when our entry disappears, without touching others", async () => {
      const { cli, state, calls } = fakeCli({});
      const h = harness(cli, { driftIntervalMs: 5 });
      await h.service.apply({ enabled: true, httpsPort: 443 });
      state.served = { port: 443, target: "http://127.0.0.1:9" };
      await waitFor(() => h.service.status.state === "problem");
      assert.deepEqual(h.service.status, {
        state: "problem",
        problem: { code: "entry_changed" },
      });
      assert.equal(h.origin(), undefined);
      assert.deepEqual(calls, ["serve 443 http://127.0.0.1:47391"]);
    });

    void it("stops checking once turned off", async () => {
      const { cli } = fakeCli({});
      let checks = 0;
      const counted: TailscaleCli = {
        ...cli,
        serveStatus: async () => ((checks += 1), cli.serveStatus()),
      };
      const h = harness(counted, { driftIntervalMs: 5 });
      await h.service.apply({ enabled: true, httpsPort: 443 });
      await h.service.apply({ enabled: false, httpsPort: 443 });
      const seen = checks;
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(checks, seen);
    });
  });
});
