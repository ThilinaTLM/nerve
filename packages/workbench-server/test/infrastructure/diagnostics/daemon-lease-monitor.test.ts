import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DaemonFile } from "@nervekit/contracts/status";
import { createDaemonLeaseMonitor } from "../../../src/infrastructure/diagnostics/daemon-lease-monitor.js";

async function home(t: test.TestContext) {
  const path = await mkdtemp(join(tmpdir(), "nerve-daemon-lease-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

function daemon(dataDir: string): DaemonFile {
  return {
    daemonId: "daemon_test",
    pid: process.pid,
    host: "127.0.0.1",
    port: 3747,
    url: "http://127.0.0.1:3747",
    startedAt: new Date().toISOString(),
    dataDir,
    version: "test",
  };
}

test("publishes, heartbeats, republishes, annotates, and removes one lease", async (t) => {
  const dataDir = await home(t);
  let time = Date.now();
  const monitor = await createDaemonLeaseMonitor(dataDir, {
    heartbeatIntervalMs: 5,
    now: () => new Date(time++),
  });
  const path = join(dataDir, "daemon.json");
  await monitor.publish(daemon(dataDir));
  const first = JSON.parse(await readFile(path, "utf8"));
  assert.equal(first.argv.length > 0, true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const heartbeat = JSON.parse(await readFile(path, "utf8"));
  assert.notEqual(heartbeat.lastHeartbeatAt, first.lastHeartbeatAt);
  await monitor.publish({
    ...daemon(dataDir),
    mobileHttps: {
      url: "https://127.0.0.1:3748",
      port: 3748,
      caCertUrl: "http://127.0.0.1:3747/api/mobile/ca.crt",
    },
  });
  monitor.markCrashReported("/tmp/crash.json");
  const annotated = JSON.parse(await readFile(path, "utf8"));
  assert.equal(annotated.crashReportPath, "/tmp/crash.json");
  assert.equal(annotated.mobileHttps.port, 3748);
  await monitor.close();
  await assert.rejects(stat(path), { code: "ENOENT" });
});

test("reports a dead stale lease once and refuses a live owner", async (t) => {
  const dataDir = await home(t);
  const path = join(dataDir, "daemon.json");
  await writeFile(path, JSON.stringify({ ...daemon(dataDir), pid: 999_999 }));
  const monitor = await createDaemonLeaseMonitor(dataDir, {
    isProcessAlive: () => false,
  });
  await monitor.close();
  assert.equal((await readdir(join(dataDir, "crashes"))).length, 1);

  await writeFile(path, JSON.stringify({ ...daemon(dataDir), pid: 123 }));
  await assert.rejects(
    createDaemonLeaseMonitor(dataDir, { isProcessAlive: () => true }),
    /already owns daemon.json/,
  );
});

test("consumes the legacy runtime marker without creating an active lease", async (t) => {
  const dataDir = await home(t);
  const runtime = join(dataDir, "runtime");
  await mkdir(runtime);
  await writeFile(
    join(runtime, "orchestrator-runtime.json"),
    JSON.stringify({
      pid: 999_999,
      startedAt: new Date(Date.now() - 1_000).toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      cleanShutdown: true,
    }),
  );
  const monitor = await createDaemonLeaseMonitor(dataDir, {
    isProcessAlive: () => false,
  });
  await assert.rejects(stat(runtime), { code: "ENOENT" });
  await assert.rejects(stat(join(dataDir, "daemon.json")), { code: "ENOENT" });
  await monitor.close();
});
