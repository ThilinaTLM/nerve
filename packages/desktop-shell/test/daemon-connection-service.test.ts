import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DAEMON_LEASE_CONFLICT_CODE } from "@nervekit/contracts/storage";
import { ensureDaemonConnection } from "../src/daemon/connection.ts";
import { fakeDaemonWorld, healthyDaemon } from "./support/fake-daemon-ports.ts";

describe("daemon connection service", () => {
  it("connects to a healthy remote daemon in monitor-only mode", async () => {
    const world = fakeDaemonWorld();
    const daemon = await ensureDaemonConnection(
      {
        mode: "remote",
        remoteUrl: "https://nerve.example.com:8443/path",
        token: "tok_remote",
      },
      world.ports,
    );
    assert.equal(daemon.mode, "remote");
    assert.equal(daemon.owned, false);
    assert.equal(daemon.url, "https://nerve.example.com:8443");
    assert.equal(daemon.token, "tok_remote");
    assert.equal(world.launches.length, 0, "remote mode never launches");
    await daemon.stop();
  });

  it("requires a remote token and a passing health check", async () => {
    const noToken = fakeDaemonWorld();
    await assert.rejects(
      ensureDaemonConnection(
        { remoteUrl: "http://10.0.0.5:3747" },
        noToken.ports,
      ),
      /Missing remote daemon token/,
    );

    const unhealthy = fakeDaemonWorld();
    unhealthy.healthResults.value = false;
    await assert.rejects(
      ensureDaemonConnection(
        { remoteUrl: "http://10.0.0.5:3747", token: "tok_remote" },
        unhealthy.ports,
      ),
      /Could not connect to remote Nerve daemon/,
    );
  });

  it("adopts an existing healthy local daemon in monitor-only mode", async () => {
    const world = fakeDaemonWorld({
      env: { NERVE_HOME: "/data/nerve" },
      discovery: [healthyDaemon()],
    });
    const daemon = await ensureDaemonConnection({}, world.ports);
    assert.equal(daemon.mode, "local");
    assert.equal(daemon.owned, false);
    assert.equal(daemon.url, "http://127.0.0.1:3747");
    assert.equal(world.launches.length, 0, "existing daemons are not spawned");
    assert.equal(world.discoveryCalls[0]?.home, "/data/nerve");
    await daemon.stop();
  });

  it("rejects an existing loopback daemon when LAN access is requested", async () => {
    const world = fakeDaemonWorld({
      discovery: [healthyDaemon({ host: "127.0.0.1" })],
    });
    await assert.rejects(
      ensureDaemonConnection({ allowRemote: true }, world.ports),
      /cannot accept LAN clients/,
    );
  });

  it("rejects an existing daemon without mobile HTTPS when requested", async () => {
    const world = fakeDaemonWorld({
      discovery: [healthyDaemon()],
    });
    await assert.rejects(
      ensureDaemonConnection({ mobileHttps: true }, world.ports),
      /mobile HTTPS is not enabled/,
    );
  });

  it("fails clearly when the workbench server build is missing", async () => {
    const world = fakeDaemonWorld({
      discovery: [undefined],
      serverMainExists: false,
    });
    await assert.rejects(
      ensureDaemonConnection({}, world.ports),
      /workbench server build was not found/,
    );
    assert.equal(world.launches.length, 0);
  });

  it("raises low owned-daemon heap overrides before launch", async () => {
    const world = fakeDaemonWorld({
      env: { NERVE_DAEMON_MAX_OLD_SPACE_MB: "128" },
      discovery: [undefined, healthyDaemon()],
    });
    const daemon = await ensureDaemonConnection({}, world.ports);
    assert.equal(
      world.launches[0]?.env.NODE_OPTIONS,
      "--max-old-space-size=512",
    );
    assert.ok(
      world.logs.some(
        (entry) =>
          entry.level === "warn" && entry.message.includes("supported minimum"),
      ),
    );
    await daemon.stop();
  });

  it("adopts a daemon that wins the discovery-to-launch race", async () => {
    const world = fakeDaemonWorld({
      discovery: [undefined, undefined, healthyDaemon()],
    });
    const startup = ensureDaemonConnection({}, world.ports);
    await new Promise((resolve) => setImmediate(resolve));
    world.children[0]?.emitOutput(
      "stderr",
      `[${DAEMON_LEASE_CONFLICT_CODE}] another daemon owns daemon.json\n`,
    );
    world.children[0]?.exit(1);
    await world.scheduler.advance(200);

    const daemon = await startup;
    assert.equal(daemon.owned, false);
    assert.equal(world.launches.length, 1);
    assert.equal(world.crashReports.length, 0);
    assert.ok(
      world.logs.some((entry) => entry.message.includes("Adopted competing")),
    );
    await daemon.stop();
  });

  it("reapplies compatibility checks to a daemon adopted after a lease race", async () => {
    const world = fakeDaemonWorld({
      discovery: [undefined, undefined, healthyDaemon({ host: "127.0.0.1" })],
    });
    const startup = ensureDaemonConnection({ allowRemote: true }, world.ports);
    await new Promise((resolve) => setImmediate(resolve));
    world.children[0]?.emitOutput(
      "stderr",
      `[${DAEMON_LEASE_CONFLICT_CODE}] another daemon owns daemon.json\n`,
    );
    world.children[0]?.exit(1);
    const rejected = assert.rejects(startup, /cannot accept LAN clients/);
    await world.scheduler.advance(200);
    await rejected;
  });

  it("fails clearly when a competing daemon never becomes healthy", async () => {
    const world = fakeDaemonWorld({ discovery: [undefined] });
    const startup = ensureDaemonConnection(
      { startupTimeoutMs: 1_000 },
      world.ports,
    );
    await new Promise((resolve) => setImmediate(resolve));
    world.children[0]?.emitOutput(
      "stderr",
      `[${DAEMON_LEASE_CONFLICT_CODE}] another daemon owns daemon.json\n`,
    );
    world.children[0]?.exit(1);
    const rejected = assert.rejects(startup, /did not become ready within/);
    await world.scheduler.advance(1_000);
    await rejected;
    assert.equal(world.crashReports.length, 0);
  });

  it("launches an owned daemon when no existing daemon is found", async () => {
    const world = fakeDaemonWorld({
      env: { NERVE_HOST: "127.0.0.1" },
      discovery: [undefined, healthyDaemon()],
    });
    const daemon = await ensureDaemonConnection({ port: 4000 }, world.ports);
    assert.equal(daemon.owned, true);
    assert.equal(daemon.mode, "local");
    assert.equal(world.launches.length, 1);
    assert.equal(world.launches[0]?.serverMain, "/opt/nerve/server/main.js");
    assert.equal(world.launches[0]?.env.NERVE_PORT, undefined);
    assert.deepEqual(world.launches[0]?.args, ["--port", "4000"]);
    assert.equal(world.launches[0]?.env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(daemon.url, "http://127.0.0.1:3747");
    await daemon.stop();
  });
});
