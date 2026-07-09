import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chromiumLoopbackProxyBypassRules,
  formatElectronDownloadFailure,
  formatProxyPreparationForLog,
  prepareElectronDownloadEnv,
} from "../src/electron-download-env.ts";

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

  it("does not overwrite standard proxy env values", () => {
    const env: NodeJS.ProcessEnv = {
      HTTPS_PROXY: "http://standard.example.com:8080",
      HTTP_PROXY: "http://standard.example.com:8080",
      npm_config_proxy: "http://npm.example.com:8080",
      ELECTRON_GET_USE_PROXY: "false",
      NODE_EXTRA_CA_CERTS: "/tmp/existing-ca.pem",
      NODE_USE_ENV_PROXY: "0",
      NODE_USE_SYSTEM_CA: "0",
      npm_config_cafile: "/tmp/npm-ca.pem",
    };

    const result = prepareElectronDownloadEnv(env);

    assert.equal(env.HTTPS_PROXY, "http://standard.example.com:8080");
    assert.equal(env.HTTP_PROXY, "http://standard.example.com:8080");
    assert.equal(env.ELECTRON_GET_USE_PROXY, "false");
    assert.equal(env.NODE_EXTRA_CA_CERTS, "/tmp/existing-ca.pem");
    assert.equal(env.NODE_USE_ENV_PROXY, "0");
    assert.equal(env.NODE_USE_SYSTEM_CA, "0");
    assert.equal(result.enabledElectronGetProxy, false);
    assert.equal(result.enabledNodeEnvProxy, false);
    assert.equal(result.enabledNodeSystemCa, false);
    assert.deepEqual(result.copiedFromPackageManagerConfig, []);
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

  it("adds loopback no-proxy entries even without proxy configuration", () => {
    const env: NodeJS.ProcessEnv = {};

    const result = prepareElectronDownloadEnv(env);

    assert.equal(env.NO_PROXY, "localhost,127.0.0.1,::1");
    assert.equal(env.no_proxy, "localhost,127.0.0.1,::1");
    assert.equal(env.NODE_USE_SYSTEM_CA, "1");
    assert.equal(result.proxyConfigured, false);
    assert.equal(result.enabledNodeEnvProxy, false);
    assert.equal(result.enabledNodeSystemCa, true);
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

  it("exports a loopback bypass list for Chromium sessions", () => {
    assert.match(chromiumLoopbackProxyBypassRules, /<local>/);
    assert.match(chromiumLoopbackProxyBypassRules, /localhost/);
    assert.match(chromiumLoopbackProxyBypassRules, /127\.0\.0\.1/);
    assert.match(chromiumLoopbackProxyBypassRules, /\[::1\]/);
    assert.equal(
      chromiumLoopbackProxyBypassRules.includes("<-loopback>"),
      false,
    );
  });
});
