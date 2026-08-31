import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildOrchestratorArgs,
  buildOrchestratorEnv,
  resolveDaemonHeapProfile,
  resolveDaemonPaths,
  resolveReadinessTimeoutMs,
  wantsLanAccess,
} from "../src/daemon/profile.ts";

describe("daemon profile policy", () => {
  it("defaults to ~/.nerve and honors explicit NERVE_HOME", () => {
    const defaults = resolveDaemonPaths({}, "/home/test");
    assert.equal(defaults.home, join("/home/test", ".nerve"));
    assert.equal(
      defaults.daemonPath,
      join("/home/test", ".nerve", "daemon.json"),
    );
    assert.equal(
      defaults.localTokenPath,
      join("/home/test", ".nerve", "secrets", "daemon-token"),
    );

    const explicit = resolveDaemonPaths(
      { NERVE_HOME: "/data/nerve-home" },
      "/home/test",
    );
    assert.equal(explicit.home, "/data/nerve-home");
    assert.equal(explicit.daemonPath, join("/data/nerve-home", "daemon.json"));

    const blank = resolveDaemonPaths({ NERVE_HOME: "   " }, "/home/test");
    assert.equal(blank.home, join("/home/test", ".nerve"));
  });

  it("resolves the readiness timeout with sane fallbacks", () => {
    assert.equal(resolveReadinessTimeoutMs({}), 60_000);
    assert.equal(
      resolveReadinessTimeoutMs({ NERVE_DAEMON_STARTUP_TIMEOUT_MS: "15000" }),
      15_000,
    );
    assert.equal(
      resolveReadinessTimeoutMs({ NERVE_DAEMON_STARTUP_TIMEOUT_MS: "0" }),
      60_000,
    );
    assert.equal(
      resolveReadinessTimeoutMs({ NERVE_DAEMON_STARTUP_TIMEOUT_MS: "abc" }),
      60_000,
    );
  });

  it("resolves the daemon memory option with a supported floor", () => {
    assert.deepEqual(resolveDaemonHeapProfile({}), {
      requestedMb: 4096,
      effectiveMb: 4096,
      source: "default",
    });
    assert.deepEqual(
      resolveDaemonHeapProfile({ NERVE_DAEMON_MAX_OLD_SPACE_MB: "8192" }),
      { requestedMb: 8192, effectiveMb: 8192, source: "environment" },
    );
    assert.deepEqual(resolveDaemonHeapProfile({}, 128), {
      requestedMb: 128,
      effectiveMb: 512,
      source: "configuration",
    });
    assert.deepEqual(
      resolveDaemonHeapProfile({ NERVE_DAEMON_MAX_OLD_SPACE_MB: "256" }, 8192),
      { requestedMb: 256, effectiveMb: 512, source: "environment" },
    );
    assert.equal(
      resolveDaemonHeapProfile({ NERVE_DAEMON_MAX_OLD_SPACE_MB: "-5" }, 2048)
        .effectiveMb,
      2048,
    );
  });

  it("builds the owned-child launch environment", () => {
    const env = buildOrchestratorEnv(
      {
        host: "0.0.0.0",
        port: 4000,
        httpsPort: 4443,
        allowRemote: true,
        mobileHttps: true,
        webDistPath: "/opt/web",
      },
      {
        NODE_OPTIONS:
          "--enable-source-maps --max-old-space-size=128 --max_old_space_size=256",
        PATH: "/usr/bin",
      },
    );
    assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(
      env.NODE_OPTIONS,
      "--enable-source-maps --max-old-space-size=4096",
    );
    assert.equal(env.NERVE_HOST, undefined);
    assert.equal(env.NERVE_PORT, undefined);
    assert.equal(env.NERVE_HTTPS_PORT, undefined);
    assert.equal(env.NERVE_ALLOW_REMOTE, undefined);
    assert.equal(env.NERVE_MOBILE_HTTPS, undefined);
    assert.deepEqual(
      buildOrchestratorArgs({
        host: "0.0.0.0",
        port: 4000,
        httpsPort: 4443,
        allowRemote: true,
        mobileHttps: true,
      }),
      [
        "--host",
        "0.0.0.0",
        "--port",
        "4000",
        "--https-port",
        "4443",
        "--allow-remote",
        "--mobile-https",
      ],
    );
    assert.equal(env.NERVE_WEB_DIST, "/opt/web");
    assert.equal(env.PATH, "/usr/bin");

    const defaults = buildOrchestratorEnv({}, {});
    assert.equal(defaults.NERVE_HOST, undefined);
    assert.equal(defaults.NERVE_PORT, undefined);
    assert.equal(defaults.NERVE_ALLOW_REMOTE, undefined);
  });

  it("detects LAN access intent from options and environment", () => {
    assert.equal(wantsLanAccess({}, {}), false);
    assert.equal(wantsLanAccess({ allowRemote: true }, {}), true);
    assert.equal(wantsLanAccess({}, { NERVE_ALLOW_REMOTE: "1" }), true);
    assert.equal(wantsLanAccess({ host: "192.168.1.5" }, {}), true);
    assert.equal(wantsLanAccess({ host: "127.0.0.1" }, {}), false);
    assert.equal(wantsLanAccess({}, { NERVE_HOST: "0.0.0.0" }), true);
  });
});
