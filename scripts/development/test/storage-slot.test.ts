import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertSlotPaths,
  createSlotParent,
  developmentEnvironment,
  resolveStorageSlot,
} from "../storage-slot.mjs";
import {
  assertPortFree,
  inspectSlotDaemon,
  preflightSlot,
} from "../slot-preflight.mjs";
import { runOwned } from "../owned-processes.mjs";
import { prepareDevelopmentSlot } from "../storage-preparation.js";
import { acquireStorageHomeLock } from "../../../packages/workbench-server/src/infrastructure/storage-migrations/runner/home-lock.js";

const supportedManifests = [
  { format: "nerve-home", version: 1 },
  { format: "nerve-home", version: 2, homeClass: "standard" },
  { format: "nerve-home", version: 2, homeClass: "disposable" },
];

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "nerve-dev-slot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("slot selection isolates homes, profiles, and ports without trusting cwd or ambient overrides", async (t) => {
  const root = await temporary(t);
  const slot = resolveStorageSlot(["--", "--slot", "2"], root);
  const one = resolveStorageSlot([], root);
  assert.notEqual(one.home, slot.home);
  assert.notEqual(one.profile, slot.profile);
  assert.notEqual(one.httpPort, slot.httpPort);
  assert.notEqual(one.httpsPort, slot.httpsPort);
  assert.notEqual(one.uiPort, slot.uiPort);
  const env = developmentEnvironment(slot, {
    NERVE_HOME: "/live/home",
    NERVE_ELECTRON_USER_DATA: "/live/profile",
    NERVE_PORT: "3747",
    NERVE_API_TARGET: "http://live",
    NERVE_DAEMON_TOKEN: "live-token",
    NERVE_WEB_DIST: "/old/renderer",
    ELECTRON_RUN_AS_NODE: "1",
    NERVE_CGROUP_ROOT: "/live/process-scope",
    NERVE_LINUX_DELEGATED_CGROUP: "1",
    PATH: "keep",
  });
  assert.equal(env.NERVE_HOME, join(root, "data", "storage-2"));
  assert.equal(
    env.NERVE_ELECTRON_USER_DATA,
    join(root, "data", "desktop-profile-2"),
  );
  assert.equal(env.NERVE_API_TARGET, `http://127.0.0.1:${slot.httpPort}`);
  assert.equal(env.NERVE_PORT, String(slot.httpPort));
  assert.equal(env.NERVE_ALLOW_REMOTE, "0");
  assert.equal(env.PATH, "keep");
  assert.equal(env.NERVE_DAEMON_TOKEN, undefined);
  assert.equal(env.NERVE_WEB_DIST, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.NERVE_CGROUP_ROOT, undefined);
  assert.equal(env.NERVE_LINUX_DELEGATED_CGROUP, undefined);
  for (const args of [
    ["--slot", "0"],
    ["--slot", "101"],
    ["--slot", "01"],
    ["--slot", "1.5"],
    ["--slot"],
    ["--slot", "2", "--slot", "3"],
    ["--home", "/live"],
  ]) {
    assert.throws(() => resolveStorageSlot(args, root), /--slot N/);
  }
});

test("UI-only overrides keep the requested token home and target paired", () => {
  const slot = resolveStorageSlot();
  const external = developmentEnvironment(
    slot,
    { NERVE_HOME: "/custom/home", NERVE_API_TARGET: "http://127.0.0.1:3747" },
    true,
  );
  assert.equal(external.NERVE_HOME, "/custom/home");
  assert.equal(external.NERVE_API_TARGET, "http://127.0.0.1:3747");
  assert.throws(
    () =>
      developmentEnvironment(
        slot,
        { NERVE_API_TARGET: "http://127.0.0.1:3747" },
        true,
      ),
    /Set both/,
  );
  assert.equal(
    developmentEnvironment(
      slot,
      { NERVE_API_TARGET: "https://example.com" },
      true,
    ).NERVE_API_TARGET,
    "https://example.com",
  );
  assert.throws(
    () =>
      developmentEnvironment(
        slot,
        { NERVE_API_TARGET: "file:///tmp/local" },
        true,
      ),
    /HTTP or HTTPS/,
  );
  const discovered = developmentEnvironment(
    slot,
    { NERVE_HOME: "/custom/home" },
    true,
  );
  assert.equal(discovered.NERVE_API_TARGET, undefined);
  assert.equal(discovered.NERVE_HOME, "/custom/home");
  assert.equal(developmentEnvironment(slot, {}, true).NERVE_HOME, slot.home);
});

test("redirected development directories fail before creating anything in their target", async (t) => {
  const root = await temporary(t);
  const outside = await temporary(t);
  const slot = resolveStorageSlot([], root);
  await symlink(outside, slot.data, "dir");
  await assert.rejects(createSlotParent(slot), /real directory/);
  await assert.rejects(readFile(join(outside, "storage-1", "manifest.json")), {
    code: "ENOENT",
  });
  await rm(slot.data);
  await createSlotParent(slot);
  await symlink(outside, slot.profile, "dir");
  await assert.rejects(assertSlotPaths(slot), /real directory/);
});

test("manually copied homes are preserved for startup migration regardless of home class", async (t) => {
  for (const manifest of supportedManifests) {
    const slot = resolveStorageSlot([], await temporary(t));
    await mkdir(slot.home, { recursive: true });
    const raw = JSON.stringify(manifest);
    await writeFile(join(slot.home, "manifest.json"), raw);
    await writeFile(join(slot.home, "migration-sentinel"), "unmigrated");
    // No database/configuration is provided: preparation must leave existing
    // storage alone so the owning daemon/desktop can run its migration workflow.
    await prepareDevelopmentSlot(slot);
    assert.equal(await readFile(join(slot.home, "manifest.json"), "utf8"), raw);
    assert.equal(
      await readFile(join(slot.home, "migration-sentinel"), "utf8"),
      "unmigrated",
    );
    assert.deepEqual((await readdir(slot.home)).sort(), [
      "manifest.json",
      "migration-sentinel",
    ]);
  }
});

test("development preparation still rejects unsupported storage layouts", async (t) => {
  const slot = resolveStorageSlot([], await temporary(t));
  await mkdir(slot.home, { recursive: true });
  await writeFile(
    join(slot.home, "manifest.json"),
    JSON.stringify({ format: "nerve-home", version: 999 }),
  );
  await assert.rejects(prepareDevelopmentSlot(slot), /manifest/);
});

async function daemonFixture(slot) {
  await mkdir(join(slot.home, "secrets"), { recursive: true });
  await writeFile(
    join(slot.home, "manifest.json"),
    JSON.stringify({
      format: "nerve-home",
      version: 2,
      homeClass: "standard",
    }),
  );
  await writeFile(join(slot.home, "secrets", "daemon-token"), "slot-token");
  const daemon = {
    daemonId: "daemon_test",
    pid: process.pid,
    host: "127.0.0.1",
    port: slot.httpPort,
    url: `http://127.0.0.1:${slot.httpPort}`,
    dataDir: slot.home,
    version: "test",
    startedAt: new Date().toISOString(),
    mobileHttps: {
      port: slot.httpsPort,
      url: `https://127.0.0.1:${slot.httpsPort}`,
      caCertUrl: `http://127.0.0.1:${slot.httpPort}/nerve-local-ca.pem`,
    },
  };
  await writeFile(join(slot.home, "daemon.json"), JSON.stringify(daemon));
  return daemon;
}

test("only matching authenticated daemon metadata permits reuse and avoids probing/stopping its ports", async (t) => {
  const root = await temporary(t);
  const slot = resolveStorageSlot([], root);
  const daemon = await daemonFixture(slot);
  const request = async (url, options) => {
    assert.equal(url.pathname, "/api/health");
    assert.equal(options.headers.authorization, "Bearer slot-token");
    return { ok: true };
  };
  assert.equal(
    await preflightSlot(slot, {
      inspect: (s) => inspectSlotDaemon(s, request),
      probe: () => assert.fail("must not probe a reused daemon"),
    }),
    true,
  );
  daemon.port++;
  await writeFile(join(slot.home, "daemon.json"), JSON.stringify(daemon));
  await assert.rejects(inspectSlotDaemon(slot, request), /does not match/);
  await writeFile(join(slot.home, "daemon.json"), "invalid");
  await assert.rejects(
    inspectSlotDaemon(slot, request),
    /Invalid development daemon/,
  );
});

test("manual home copies discard only destination runtime metadata without contacting the source", async (t) => {
  const root = await temporary(t);
  const source = {
    ...resolveStorageSlot([], root),
    home: join(root, "production"),
    httpPort: 3747,
    httpsPort: 3748,
  };
  await daemonFixture(source);
  await writeFile(
    join(source.home, "persistent-data"),
    "copied database contents",
  );
  const sourceMetadata = await readFile(
    join(source.home, "daemon.json"),
    "utf8",
  );
  const slot = resolveStorageSlot(["--slot", "3"], root);
  await mkdir(slot.data, { recursive: true });
  await cp(source.home, slot.home, { recursive: true });
  const noSourceRequest = () =>
    assert.fail("must not contact the source daemon");
  assert.equal(await inspectSlotDaemon(slot, noSourceRequest), false);
  // UI-only inspection is read-only, even for copied runtime metadata.
  assert.equal(
    await readFile(join(slot.home, "daemon.json"), "utf8"),
    sourceMetadata,
  );
  const probes = [];
  assert.equal(
    await preflightSlot(slot, {
      inspect: (s) => inspectSlotDaemon(s, noSourceRequest),
      probe: async (port) => {
        probes.push(port);
        assert.equal(
          await readFile(join(slot.home, "daemon.json"), "utf8"),
          sourceMetadata,
        );
      },
    }),
    false,
  );
  assert.deepEqual(probes, [slot.httpPort, slot.httpsPort]);
  await assert.rejects(readFile(join(slot.home, "daemon.json")), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(join(source.home, "daemon.json"), "utf8"),
    sourceMetadata,
  );
  for (const file of [
    "manifest.json",
    "secrets/daemon-token",
    "persistent-data",
  ]) {
    assert.deepEqual(
      await readFile(join(slot.home, file)),
      await readFile(join(source.home, file)),
    );
  }
  process.kill(process.pid, 0); // The recorded live source process is untouched.
  const lock = await acquireStorageHomeLock(slot.home, { timeoutMs: 0 });
  await lock.release();
  assert.equal(await preflightSlot(slot, { probe: async () => {} }), false);
});

test("copied metadata does not require the original home to exist, including another slot", async (t) => {
  for (const dataDir of ["missing-production", "data/storage-2"]) {
    const root = await temporary(t);
    const slot = resolveStorageSlot([], root);
    const daemon = await daemonFixture(slot);
    daemon.dataDir = join(root, dataDir);
    await writeFile(join(slot.home, "daemon.json"), JSON.stringify(daemon));
    assert.equal(await preflightSlot(slot, { probe: async () => {} }), false);
    await assert.rejects(readFile(join(slot.home, "daemon.json")), {
      code: "ENOENT",
    });
  }
});

test("port conflicts and changed ownership records prevent copied metadata cleanup", async (t) => {
  const slot = resolveStorageSlot([], await temporary(t));
  const daemon = await daemonFixture(slot);
  daemon.dataDir = join(slot.repo, "source");
  const raw = JSON.stringify(daemon);
  await writeFile(join(slot.home, "daemon.json"), raw);
  await assert.rejects(
    preflightSlot(slot, {
      probe: async () => {
        throw new Error("occupied");
      },
    }),
    /occupied/,
  );
  assert.equal(await readFile(join(slot.home, "daemon.json"), "utf8"), raw);
  daemon.dataDir = slot.home;
  const replacement = JSON.stringify(daemon);
  await assert.rejects(
    preflightSlot(slot, {
      probe: async () => {
        await writeFile(join(slot.home, "daemon.json"), replacement);
      },
    }),
    /changed during preflight/,
  );
  assert.equal(
    await readFile(join(slot.home, "daemon.json"), "utf8"),
    replacement,
  );
});

test("linked daemon records are never used or removed", async (t) => {
  const root = await temporary(t);
  const source = resolveStorageSlot(["--slot", "2"], root);
  await daemonFixture(source);
  const slot = resolveStorageSlot([], root);
  await mkdir(slot.home, { recursive: true });
  await symlink(
    join(source.home, "daemon.json"),
    join(slot.home, "daemon.json"),
  );
  await assert.rejects(preflightSlot(slot), /non-linked file/);
  assert.ok(await readFile(join(source.home, "daemon.json")));
});

test("authenticated slot daemons can be reused with any supported home manifest", async (t) => {
  const slot = resolveStorageSlot([], await temporary(t));
  await daemonFixture(slot);
  for (const manifest of supportedManifests) {
    await writeFile(join(slot.home, "manifest.json"), JSON.stringify(manifest));
    assert.equal(
      await inspectSlotDaemon(slot, async () => ({ ok: true })),
      true,
    );
  }
});

test("failed health never adopts or replaces a live daemon", async (t) => {
  const slot = resolveStorageSlot([], await temporary(t));
  await daemonFixture(slot);
  await assert.rejects(
    inspectSlotDaemon(slot, async () => ({ ok: false })),
    /owner is alive/,
  );
});

test("occupied ports are refused without disturbing the existing listener", async (t) => {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const { port } = server.address();
  await assert.rejects(assertPortFree(port), /unavailable/);
  assert.equal(server.listening, true);
});

test("child exit stops other owned children; failed launches propagate and signal handlers are removed", async (t) => {
  const root = await temporary(t);
  const ready = join(root, "ready");
  const stopped = join(root, "stopped");
  const owner = `const fs = require('node:fs'); process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(stopped)}, 'stopped'); process.exit(0); }); fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const exit = `const fs = require('node:fs'); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(ready)})) { clearInterval(timer); process.exit(7); } }, 10);`;
  const before = process.listenerCount("SIGTERM");
  await assert.rejects(
    runOwned(
      [
        [process.execPath, ["-e", owner]],
        [process.execPath, ["-e", exit]],
      ],
      { cwd: root, env: process.env },
    ),
    /exited with code 7/,
  );
  if (process.platform !== "win32")
    assert.equal(await readFile(stopped, "utf8"), "stopped");
  const ownerPid = Number(await readFile(ready, "utf8"));
  assert.throws(() => process.kill(ownerPid, 0), { code: "ESRCH" });
  assert.equal(process.listenerCount("SIGTERM"), before);
  await assert.rejects(
    runOwned([[join(root, "missing-command"), []]], {
      cwd: root,
      env: process.env,
    }),
    /Could not launch/,
  );
  assert.equal(process.listenerCount("SIGTERM"), before);
});
