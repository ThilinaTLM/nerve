import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Use a stubborn fake Electron, not the graphical app or a real home. This
// verifies signals reach the wrapper's owned child before outer escalation.
test(
  "isolated desktop wrapper escalates at Electron rather than orphaning it",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "nerve-electron-owner-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "dist/platform/electron"), { recursive: true });
    await mkdir(join(root, "node_modules/electron"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    await cp(
      new URL("../scripts/start-electron.mjs", import.meta.url),
      join(root, "scripts/start-electron.mjs"),
    );
    await writeFile(
      join(root, "dist/platform/electron/download-environment.js"),
      `export const prepareElectronDownloadEnv = () => ({}); export const formatProxyPreparationForLog = x => x; export const formatElectronDownloadFailure = String;`,
    );
    const executable = join(root, "fake-electron.cjs");
    const marker = join(root, "pid.json");
    await writeFile(
      executable,
      `#!/usr/bin/env node\nconst fs = require('node:fs'); process.on('SIGTERM', () => {}); process.on('SIGINT', () => {}); fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.pid)); setInterval(() => {}, 1000);`,
    );
    await chmod(executable, 0o700);
    await writeFile(
      join(root, "node_modules/electron/index.js"),
      `module.exports = ${JSON.stringify(executable)};`,
    );
    const wrapper = spawn(
      process.execPath,
      [join(root, "scripts/start-electron.mjs")],
      {
        env: {
          ...process.env,
          NERVE_HOME: join(root, "home"),
          NERVE_ELECTRON_USER_DATA: join(root, "profile"),
          NERVE_DEBUG_PROXY: "0",
        },
        stdio: "ignore",
      },
    );
    let electronPid: number | undefined;
    t.after(() => {
      wrapper.kill("SIGKILL");
      if (electronPid) {
        try {
          process.kill(electronPid, "SIGKILL");
        } catch {
          /* Already gone. */
        }
      }
    });
    const exit = new Promise<string | number | null>((done, reject) => {
      wrapper.once("error", reject);
      wrapper.once("exit", (code, signal) => done(signal ?? code));
    });
    const deadline = Date.now() + 5000;
    while (!electronPid) {
      try {
        electronPid = JSON.parse(await readFile(marker, "utf8")) as number;
      } catch {
        if (Date.now() >= deadline) assert.fail("Fake Electron did not start.");
        await new Promise((done) => setTimeout(done, 10));
      }
    }
    wrapper.kill("SIGTERM");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        exit,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error("Wrapper did not terminate its Electron child."),
              ),
            6000,
          );
        }),
      ]);
      assert.equal(outcome, "SIGKILL");
      assert.throws(() => process.kill(electronPid!, 0), { code: "ESRCH" });
    } finally {
      clearTimeout(timeout);
    }
  },
);
