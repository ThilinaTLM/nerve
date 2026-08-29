import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  captureDiagnosticReport,
  checkHealth,
  findHealthyDaemon,
  resolveDaemonLaunch,
} from "../src/daemon/adapters/node-process.ts";

describe("daemon Node health integration", () => {
  it("wraps Linux desktop daemons in a delegated systemd scope", () => {
    const launch = resolveDaemonLaunch({
      serverMain: "/opt/nerve/main.js",
      args: ["--port", "3747"],
      env: { TEST_VALUE: "preserved" },
    });
    if (process.platform === "linux") {
      assert.equal(launch.command, "systemd-run");
      assert.ok(launch.args.includes("--property=Delegate=yes"));
      assert.ok(launch.args.includes("/opt/nerve/main.js"));
      assert.equal(launch.env.TEST_VALUE, "preserved");
      assert.equal(launch.env.NERVE_LINUX_DELEGATED_CGROUP, "1");
      assert.match(launch.systemdUnit ?? "", /^nerve-daemon-.*\.scope$/);
    } else {
      assert.equal(launch.command, process.execPath);
    }

    const compatibility = resolveDaemonLaunch({
      serverMain: "/opt/nerve/main.js",
      env: { NERVE_ALLOW_UNCONTAINED_PROCESSES: "1" },
    });
    assert.equal(compatibility.command, process.execPath);
    assert.equal(compatibility.systemdUnit, undefined);
  });
  it("waits until a PID-scoped diagnostic report is stable", async () => {
    if (process.platform === "win32") return;
    const home = await mkdtemp(join(tmpdir(), "nerve-diagnostic-capture-"));
    const crashes = join(home, "crashes");
    await mkdir(crashes);
    const pid = 91234;
    const report = join(crashes, `report.20260822.000000.${pid}.0.001.json`);
    try {
      const child = {
        pid,
        kill: () => {
          setTimeout(() => void writeFile(report, '{"complete":true}'), 10);
          return true;
        },
      } as Parameters<typeof captureDiagnosticReport>[0];
      const result = await captureDiagnosticReport(child, home);
      assert.equal(result.outcome, "captured");
      assert.equal(result.path, report);
      assert.ok(result.elapsedMs < 5_000);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("uses the authenticated minimal health endpoint", async () => {
    let requestedUrl = "";
    let authorization = "";
    const result = await checkHealth("http://127.0.0.1:3747", "tok_test", {
      now: (() => {
        let current = 10;
        return () => current++;
      })(),
      fetch: async (input, init) => {
        requestedUrl = String(input);
        authorization = String(
          (init?.headers as Record<string, string>)?.authorization,
        );
        return new Response(null, { status: 200 });
      },
    });

    assert.equal(requestedUrl, "http://127.0.0.1:3747/api/health");
    assert.equal(authorization, "Bearer tok_test");
    assert.deepEqual(result, {
      healthy: true,
      outcome: "ok",
      durationMs: 1,
      status: 200,
    });
  });

  it("fails closed for invalid daemon metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-daemon-metadata-"));
    try {
      const daemonPath = join(root, "daemon.json");
      await writeFile(daemonPath, "not-json\n");
      await assert.rejects(
        findHealthyDaemon({
          home: root,
          daemonPath,
          localTokenPath: join(root, "secrets", "daemon-token"),
        }),
        /refusing to start a second daemon/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies HTTP, network, and timeout failures", async () => {
    const http = await checkHealth("http://127.0.0.1:3747", "tok_test", {
      fetch: async () => new Response(null, { status: 503 }),
    });
    assert.equal(http.outcome, "http_error");
    assert.equal(http.status, 503);

    const network = await checkHealth("http://127.0.0.1:3747", "tok_test", {
      fetch: async () => {
        throw new Error("connection refused");
      },
    });
    assert.equal(network.outcome, "network_error");
    assert.equal(network.error, "connection refused");

    const timedOut = await checkHealth("http://127.0.0.1:3747", "tok_test", {
      timeoutMs: 1,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    });
    assert.equal(timedOut.outcome, "timeout");
    assert.equal(timedOut.error, "aborted");
  });
});
