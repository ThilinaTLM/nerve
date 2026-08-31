import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatElectronDownloadFailure,
  formatProxyPreparationForLog,
  prepareElectronDownloadEnv,
} from "../src/platform/electron/download-environment.ts";

describe("prepareElectronDownloadEnv", () => {
  it("copies package-manager proxy config for Electron downloads", () => {
    const env: NodeJS.ProcessEnv = {
      npm_config_proxy: "http://user:secret@proxy.example.com:8080",
      npm_config_cafile: "/tmp/corp-ca.pem",
    };

    const result = prepareElectronDownloadEnv(env);

    assert.equal(env.HTTPS_PROXY, "http://user:secret@proxy.example.com:8080");
    assert.equal(env.HTTP_PROXY, "http://user:secret@proxy.example.com:8080");
    assert.equal(env.ELECTRON_GET_USE_PROXY, "true");
    assert.equal(env.NODE_EXTRA_CA_CERTS, "/tmp/corp-ca.pem");
    assert.equal(env.NODE_USE_ENV_PROXY, "1");
    assert.equal(env.NODE_USE_SYSTEM_CA, "1");
    assert.equal(result.proxyConfigured, true);
    assert.equal(result.enabledElectronGetProxy, true);
    assert.equal(result.enabledNodeEnvProxy, true);
    assert.equal(result.enabledNodeSystemCa, true);
    assert.deepEqual(result.copiedFromPackageManagerConfig, [
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NODE_EXTRA_CA_CERTS",
    ]);
  });

  it("always adds loopback entries to NO_PROXY and no_proxy", () => {
    const env: NodeJS.ProcessEnv = {
      NO_PROXY: "example.test,LOCALHOST",
      no_proxy: "internal.test",
      npm_config_noproxy: "corp.test,example.test",
    };

    const result = prepareElectronDownloadEnv(env);

    assert.equal(
      env.NO_PROXY,
      "example.test,LOCALHOST,internal.test,corp.test,127.0.0.1,::1",
    );
    assert.equal(env.no_proxy, env.NO_PROXY);
    assert.equal(result.noProxyUpdated, true);
  });

  it("reports only redacted diagnostic fields", () => {
    const env: NodeJS.ProcessEnv = {
      npm_config_proxy: "http://user:secret@proxy.example.com:8080",
    };
    const result = prepareElectronDownloadEnv(env);
    const log = formatProxyPreparationForLog(result, env);

    assert.deepEqual(log, {
      proxyConfigured: true,
      enabledElectronGetProxy: true,
      enabledNodeEnvProxy: true,
      enabledNodeSystemCa: true,
      copiedFromPackageManagerConfig: ["HTTPS_PROXY", "HTTP_PROXY"],
      noProxyUpdated: true,
      nodeExtraCaCertsFromPackageManagerCafile: false,
      envPresent: {
        HTTPS_PROXY: true,
        https_proxy: false,
        HTTP_PROXY: true,
        http_proxy: false,
        NO_PROXY: true,
        no_proxy: true,
        NODE_EXTRA_CA_CERTS: false,
        NODE_USE_ENV_PROXY: true,
        NODE_USE_SYSTEM_CA: true,
        ELECTRON_GET_USE_PROXY: true,
        ELECTRON_MIRROR: false,
      },
      noProxyContainsLoopback: {
        localhost: true,
        "127.0.0.1": true,
        "::1": true,
      },
    });
  });
});

describe("Electron proxy diagnostics", () => {
  it("redacts URL credentials in download failures", () => {
    const message = formatElectronDownloadFailure(
      new Error("failed at https://user:secret@example.com/electron.zip"),
    );

    assert.match(message, /https:\/\/\[redacted\]@example\.com/);
    assert.doesNotMatch(message, /secret/);
  });
});
