import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DaemonStartupError,
  isDaemonStartupErrorCode,
} from "../src/daemon/diagnostics.ts";
import { DAEMON_RESTART_BACKOFF_MS } from "../src/daemon/policy.ts";
import { DaemonSupervisor } from "../src/daemon/supervisor.ts";
import type {
  DaemonStatus,
  DaemonStatusInfo,
  ManagedDaemon,
} from "../src/daemon/contracts.ts";
import {
  fakeDaemonWorld,
  type FakeDaemonWorld,
  healthyDaemon,
} from "./support/fake-daemon-ports.ts";

const paths = {
  home: "/data/nerve",
  daemonPath: "/data/nerve/daemon.json",
  localTokenPath: "/data/nerve/auth/local-token",
};

function ownedSupervisor(
  world: FakeDaemonWorld,
  readinessTimeoutMs = 1000,
): DaemonSupervisor {
  return new DaemonSupervisor(
    {
      mode: "local",
      owned: true,
      paths,
      serverMain: "/opt/nerve/server/main.js",
      launchEnv: { ELECTRON_RUN_AS_NODE: "1" },
      readinessTimeoutMs,
      effectiveMaxOldSpaceMb: 512,
    },
    world.ports,
  );
}

function recordStatuses(daemon: ManagedDaemon) {
  const statuses: Array<{ status: DaemonStatus; info?: DaemonStatusInfo }> = [];
  daemon.onStatusChange((status, info) => statuses.push({ status, info }));
  return statuses;
}

describe("daemon supervisor", () => {
  it("preserves classified daemon output when a child exits during startup", async () => {
    const world = fakeDaemonWorld({ discovery: [undefined] });
    const startup = ownedSupervisor(world).startOwned();
    world.children[0]?.emitOutput(
      "stderr",
      "RunRevisionConflictError: invalid lineage\ncode: 'RUN_REVISION_CONFLICT'\n",
    );
    world.children[0]?.exit(1);
    const rejected = assert.rejects(startup, (error) => {
      assert.ok(error instanceof DaemonStartupError);
      assert.match(error.message, /exited before it became ready with code 1/);
      assert.match(error.message, /Startup timeout: 1000ms/);
      assert.match(error.message, /Crash report: \/crash\/1.json/);
      assert.match(error.message, /Effective daemon heap: 512 MB/);
      assert.doesNotMatch(error.message, /exhausted its JavaScript heap/);
      assert.match(error.daemonOutput, /RunRevisionConflictError/);
      assert.equal(
        isDaemonStartupErrorCode(error, "RUN_REVISION_CONFLICT"),
        true,
      );
      return true;
    });
    await world.scheduler.advance(1_000);
    await rejected;
    assert.equal(world.crashReports[0]?.kind, "startupExit");
  });

  it("adds actionable guidance for startup heap exhaustion without retrying", async () => {
    const world = fakeDaemonWorld({ discovery: [undefined] });
    const startup = ownedSupervisor(world).startOwned();
    world.children[0]?.emitOutput(
      "stderr",
      "FATAL ERROR: MarkCompactCollector: young object promotion failed Allocation failed - JavaScript heap out of memory\n",
    );
    world.children[0]?.exit(null, "SIGABRT");
    const rejected = assert.rejects(startup, (error) => {
      assert.ok(error instanceof DaemonStartupError);
      assert.match(error.message, /Effective daemon heap: 512 MB/);
      assert.match(error.message, /exhausted its JavaScript heap/);
      assert.match(error.message, /NERVE_DAEMON_MAX_OLD_SPACE_MB/);
      return true;
    });
    await world.scheduler.advance(1_000);
    await rejected;
    assert.equal(world.launches.length, 1);
    assert.equal(world.crashReports[0]?.context?.effectiveMaxOldSpaceMb, 512);
  });

  it("extends startup readiness while the daemon reports migration progress", async () => {
    const world = fakeDaemonWorld({ discovery: [undefined] });
    const startup = ownedSupervisor(world, 1_000).startOwned();

    await world.scheduler.advance(800);
    world.children[0]?.emitOutput(
      "stderr",
      'NERVE_STARTUP_PROGRESS {"type":"nerve.startup.progress","phase":"storage-migration","message":"Upgrading workspace storage"}\n',
    );
    await world.scheduler.advance(600);
    const rejected = assert.rejects(startup, (error) => {
      assert.ok(error instanceof DaemonStartupError);
      assert.match(error.message, /exited before it became ready/);
      assert.doesNotMatch(error.message, /did not become ready within/);
      return true;
    });
    world.children[0]?.exit(1);
    await world.scheduler.advance(200);
    await rejected;
  });

  it("restarts after an owned child exit and reports crash details", async () => {
    const world = fakeDaemonWorld({ discovery: [healthyDaemon()] });
    const daemon = await ownedSupervisor(world).startOwned();
    const statuses = recordStatuses(daemon);
    world.children[0]?.emitOutput("stderr", "boom happened\n");
    world.children[0]?.exit(1);
    await world.scheduler.advance(DAEMON_RESTART_BACKOFF_MS[0]);
    assert.equal(daemon.getStatus(), "ready");
    assert.equal(world.launches.length, 2);
    assert.deepEqual(
      statuses.map((entry) => entry.status),
      ["restarting", "ready"],
    );
    assert.equal(statuses[0]?.info?.attempt, 1);
    const crash = world.crashReports[0];
    assert.equal(crash?.kind, "childExit");
    assert.equal(crash?.home, paths.home);
    assert.equal(crash?.pid, 100);
    assert.equal(crash?.exitCode, 1);
    assert.equal(crash?.signal, null);
    assert.equal(typeof crash?.uptimeMs, "number");
    assert.match(crash?.outputTail ?? "", /boom happened/);
    await daemon.stop();
  });

  it("restarts an owned daemon after the unhealthy threshold", async () => {
    const world = fakeDaemonWorld({ discovery: [healthyDaemon()] });
    const daemon = await ownedSupervisor(world).startOwned();
    const statuses = recordStatuses(daemon);
    world.healthResults.value = false;
    world.healthResults.outcome = "timeout";
    world.healthResults.status = undefined;
    await world.scheduler.advance(10_000);
    assert.equal(daemon.getStatus(), "ready", "below threshold stays ready");
    world.healthResults.value = false;
    await world.scheduler.advance(5_000);
    // Third failure crossed the threshold; owned-child discovery succeeds during restart.
    await world.scheduler.advance(DAEMON_RESTART_BACKOFF_MS[0] + 1_000);
    assert.equal(world.launches.length, 2, "old child replaced");
    assert.deepEqual(
      world.children[0]?.kills.slice(0, 2),
      ["SIGUSR2", "SIGTERM"],
      "diagnostics are requested before the previous child is terminated",
    );
    const healthReports = world.crashReports.filter(
      (report) => report.kind === "healthFailure",
    );
    assert.equal(healthReports.length, 1);
    assert.equal((healthReports[0]?.context?.checks as unknown[])?.length, 3);
    assert.equal(daemon.getStatus(), "ready");
    assert.ok(statuses.some((entry) => entry.status === "restarting"));
    await daemon.stop();
  });

  it("recovers when the bounded final health probe succeeds", async () => {
    const world = fakeDaemonWorld({ discovery: [healthyDaemon()] });
    const originalCheck = world.ports.health.check;
    let checks = 0;
    world.ports.health.check = async () => {
      checks += 1;
      if (checks === 4) {
        return { healthy: true, outcome: "ok", durationMs: 1, status: 200 };
      }
      return {
        healthy: false,
        outcome: "timeout",
        durationMs: 1,
      };
    };
    const daemon = await ownedSupervisor(world).startOwned();
    await world.scheduler.advance(15_000);
    assert.equal(checks, 4);
    assert.equal(world.launches.length, 1);
    assert.equal(daemon.getStatus(), "ready");
    assert.deepEqual(world.children[0]?.kills, ["SIGUSR2"]);
    world.ports.health.check = originalCheck;
    await daemon.stop();
  });

  it("never diagnoses or restarts a monitor-only daemon", async () => {
    const world = fakeDaemonWorld();
    const supervisor = new DaemonSupervisor(
      {
        mode: "remote",
        owned: false,
        readinessTimeoutMs: 1_000,
      },
      world.ports,
    );
    const daemon = supervisor.initMonitorOnly({
      url: "https://nerve.example",
      token: "tok_remote",
    });
    world.healthResults.value = false;
    world.healthResults.outcome = "network_error";
    await world.scheduler.advance(15_000);
    assert.equal(daemon.getStatus(), "restarting");
    assert.equal(world.launches.length, 0);
    assert.equal(world.crashReports.length, 0);

    world.healthResults.value = true;
    await world.scheduler.advance(5_000);
    assert.equal(daemon.getStatus(), "ready");
    await daemon.stop();
  });

  it("follows the exact backoff sequence and fails after five attempts", async () => {
    const world = fakeDaemonWorld({
      discovery: [healthyDaemon(), undefined],
    });
    const readinessTimeoutMs = 1000;
    const daemon = await ownedSupervisor(
      world,
      readinessTimeoutMs,
    ).startOwned();
    const statuses = recordStatuses(daemon);
    world.healthResults.value = false;
    world.children[0]?.exit(1);
    await world.scheduler.advance(120_000);

    assert.equal(daemon.getStatus(), "failed");
    assert.equal(world.launches.length, 6, "initial launch plus five retries");
    const restartAttempts = statuses
      .filter((entry) => entry.status === "restarting")
      .map((entry) => entry.info?.attempt);
    assert.deepEqual(restartAttempts, [1, 2, 3, 4, 5]);
    const failed = statuses.at(-1);
    assert.equal(failed?.status, "failed");
    assert.match(failed?.info?.error ?? "", /after 5 attempts/);

    // Exact backoff: each retry launch happens backoff ms after the previous
    // attempt finished its readiness timeout (plus the initial exit point).
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const previousEnd =
        attempt === 1
          ? world.launches[0]!.at
          : world.launches[attempt - 1]!.at + readinessTimeoutMs;
      assert.equal(
        world.launches[attempt]!.at - previousEnd,
        DAEMON_RESTART_BACKOFF_MS[attempt - 1],
        `attempt ${attempt} backoff`,
      );
    }
    // Startup-timeout crash reports were written for the failed attempts.
    assert.equal(
      world.crashReports.filter((report) => report.kind === "startupTimeout")
        .length,
      5,
    );
    await daemon.stop();
  });

  it("serializes concurrent manual restarts", async () => {
    const world = fakeDaemonWorld({ discovery: [healthyDaemon()] });
    const daemon = await ownedSupervisor(world).startOwned();
    const first = daemon.restart();
    const second = daemon.restart();
    await world.scheduler.advance(30_000);
    await Promise.all([first, second]);
    assert.equal(daemon.getStatus(), "ready");
    assert.equal(world.launches.length, 3, "each manual restart relaunches");
    await daemon.stop();
  });

  it("stops idempotently with graceful termination and cancelled polling", async () => {
    const world = fakeDaemonWorld({ discovery: [healthyDaemon()] });
    const daemon = await ownedSupervisor(world).startOwned();
    assert.equal(world.scheduler.activeIntervals, 1);
    await daemon.stop();
    await daemon.stop();
    assert.equal(
      world.scheduler.activeIntervals,
      0,
      "health polling cancelled",
    );
    assert.deepEqual(world.children[0]?.kills, ["SIGTERM"]);
    assert.equal(world.children[0]?.exited, true);
    assert.equal(world.parentExitHooks.length, 0, "parent exit hook removed");
    // No restart is scheduled after terminal stop.
    await world.scheduler.advance(60_000);
    assert.equal(world.launches.length, 1);
    assert.equal(daemon.getStatus(), "ready");
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const world = fakeDaemonWorld({ discovery: [healthyDaemon()] });
    const daemon = await ownedSupervisor(world).startOwned();
    world.children[0]!.exitOnSigterm = false;
    const stopping = daemon.stop();
    await world.scheduler.advance(10_000);
    await stopping;
    assert.deepEqual(world.children[0]?.kills, ["SIGTERM", "SIGKILL"]);
    assert.equal(world.children[0]?.exited, true);
  });
});
