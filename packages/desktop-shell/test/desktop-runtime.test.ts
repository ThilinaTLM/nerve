import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DesktopRuntime,
  type DesktopRuntimeOptions,
} from "../src/app/desktop-runtime.js";
import {
  configureDesktopNetworkSession,
  redactProxyDescription,
  redactUrlForLog,
  type DesktopNetworkSessionPort,
} from "../src/platform/electron/network-session.js";

describe("DesktopRuntime", () => {
  it("launches its injected runtime ports exactly once", () => {
    const options = {} as DesktopRuntimeOptions;
    const launched: DesktopRuntimeOptions[] = [];
    const runtime = new DesktopRuntime(options, (value) =>
      launched.push(value),
    );

    runtime.start();
    runtime.start();

    assert.deepEqual(launched, [options]);
  });
});

describe("desktop network session", () => {
  it("configures the system proxy and redacts diagnostic values", async () => {
    const calls: string[] = [];
    const session: DesktopNetworkSessionPort = {
      async setProxy(options) {
        calls.push(`set:${options.mode}:${options.proxyBypassRules}`);
      },
      async forceReloadProxyConfig() {
        calls.push("reload");
      },
      async resolveProxy(url) {
        calls.push(`resolve:${url}`);
        return "PROXY user:secret@proxy.example:8080";
      },
    };
    const logs: Array<{ level: string; context?: Record<string, unknown> }> =
      [];

    await configureDesktopNetworkSession(
      session,
      async (level, _component, _message, data) => {
        logs.push({ level, context: data?.context });
      },
    );

    assert.equal(calls[0]?.startsWith("set:system:"), true);
    assert.deepEqual(calls.slice(1), ["reload", "resolve:http://127.0.0.1/"]);
    assert.equal(logs[0]?.level, "info");
    assert.equal(
      logs[0]?.context?.loopbackProxy,
      "PROXY [redacted]@proxy.example:8080",
    );
    assert.equal(
      redactProxyDescription("HTTPS https://user:secret@proxy.example"),
      "HTTPS https://[redacted]@proxy.example",
    );
    assert.equal(
      redactUrlForLog("https://user:secret@example.com/path"),
      "https://redacted@example.com/path",
    );
  });

  it("logs proxy configuration failures without rejecting startup", async () => {
    const errors: unknown[] = [];
    await configureDesktopNetworkSession(
      {
        async setProxy() {
          throw new Error("proxy unavailable");
        },
        async forceReloadProxyConfig() {},
        async resolveProxy() {
          return "DIRECT";
        },
      },
      async (_level, _component, _message, data) => {
        errors.push(data?.error);
      },
    );
    assert.equal((errors[0] as Error).message, "proxy unavailable");
  });
});
