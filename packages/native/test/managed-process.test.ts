import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import {
  inspectManagedTarget,
  nativeRuntimeCapabilities,
  spawnManagedProcess,
  terminateManagedTarget,
} from "../src/index.js";

const node = process.execPath;

async function outputOf(command: string): Promise<string> {
  const process = spawnManagedProcess(node, ["-e", command], {
    env: globalThis.process.env,
  });
  const chunks: Buffer[] = [];
  process.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  const exit = await process.exited;
  assert.equal(exit.exitCode, 0);
  return Buffer.concat(chunks).toString("utf8");
}

async function firstOutputNumber(
  stream: NodeJS.ReadableStream,
): Promise<number> {
  return await new Promise((resolve, reject) => {
    stream.once("data", (chunk) => resolve(Number(String(chunk).trim())));
    stream.once("error", reject);
  });
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    if (!(await processIsAlive(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Descendant process ${pid} remained alive`);
}

async function processIsAlive(pid: number): Promise<boolean> {
  if (process.platform === "linux") {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(
      () => undefined,
    );
    if (!stat) return false;
    return stat.slice(stat.lastIndexOf(")") + 2).at(0) !== "Z";
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("native managed process facade", () => {
  it("reports mandatory native runtime capabilities", () => {
    const capabilities = nativeRuntimeCapabilities();
    assert.equal(typeof capabilities.platform, "string");
    assert.ok(capabilities.platform.length > 0);
    assert.equal(Array.isArray(capabilities.capabilities), true);
  });

  it("fails module initialization when the native binding is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-native-missing-"));
    const isolatedModule = join(root, "index.ts");
    try {
      await copyFile(
        new URL("../src/index.ts", import.meta.url),
        isolatedModule,
      );
      const result = spawnSync(
        node,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          `await import(${JSON.stringify(pathToFileURL(isolatedModule).href)})`,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stderr}${result.stdout}`,
        /Native runtime failed to load: No native prebuild/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves arguments, environment, and output", async () => {
    const output = await outputOf(
      "process.stdout.write(`${process.argv[1]}:${process.env.NERVE_NATIVE_TEST}`)",
    );
    assert.equal(output, "undefined:undefined");

    const process = spawnManagedProcess(
      node,
      ["-e", "process.stdout.write(process.env.NERVE_NATIVE_TEST ?? '')"],
      { env: { ...globalThis.process.env, NERVE_NATIVE_TEST: "ok" } },
    );
    const chunks: Buffer[] = [];
    process.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    assert.equal((await process.exited).exitCode, 0);
    assert.equal(Buffer.concat(chunks).toString(), "ok");
  });

  it("inspects and terminates a serialized managed target", async () => {
    const managed = spawnManagedProcess(node, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    assert.equal(
      inspectManagedTarget(managed.target).evidence,
      "alive_verified",
    );
    const stale = { ...managed.target, identity: `${managed.identity}:stale` };
    assert.equal(inspectManagedTarget(stale).evidence, "identity_mismatch");
    const refused = await terminateManagedTarget(stale, "SIGKILL");
    assert.equal(refused.attempted, false);
    const terminated = await terminateManagedTarget(managed.target, "SIGKILL");
    assert.equal(terminated.terminated, true);
    await managed.closed;
  });

  it("observes exit before inherited pipes close", async () => {
    const managed = spawnManagedProcess(node, [
      "-e",
      `require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 150)"], { stdio: ["ignore", 1, 2] });`,
    ]);
    let closed = false;
    void managed.closed.then(() => {
      closed = true;
    });
    await managed.exited;
    assert.equal(closed, false);
    await managed.closed;
    assert.equal(closed, true);
  });

  it(
    "preserves detached descendants after the root exits",
    { timeout: 5_000 },
    async () => {
      const managed = spawnManagedProcess(node, [
        "-e",
        `const { spawn } = require("node:child_process");
       const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
       console.log(child.pid);
       child.unref();`,
      ]);
      const childPid = await firstOutputNumber(managed.stdout);
      try {
        assert.equal((await managed.closed).exitCode, 0);
        assert.equal(await processIsAlive(childPid), true);
      } finally {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // The descendant may have exited independently.
        }
        await waitForProcessExit(childPid);
      }
    },
  );

  it(
    "terminates inherited-pipe descendants after the root exits",
    { timeout: 5_000 },
    async () => {
      const managed = spawnManagedProcess(node, [
        "-e",
        `const { spawn } = require("node:child_process");
       const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", 1, 2] });
       console.log(child.pid);
       child.unref();`,
      ]);
      const childPid = await firstOutputNumber(managed.stdout);
      let closed = false;
      void managed.closed.then(() => {
        closed = true;
      });

      await managed.exited;
      assert.equal(closed, false);
      const result = await managed.terminate("SIGKILL");
      assert.equal(result.attempted, true);
      assert.ok(["job-object", "process-group"].includes(result.method));
      await managed.closed;
      await waitForProcessExit(childPid);
    },
  );

  it(
    "terminates a managed process tree promptly",
    { timeout: 5_000 },
    async () => {
      const process = spawnManagedProcess(node, [
        "-e",
        `const { spawn } = require("node:child_process");
       const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
       console.log(child.pid);
       setInterval(() => {}, 1000);`,
      ]);
      const childPid = await firstOutputNumber(process.stdout);
      const result = await process.terminate("SIGKILL");
      assert.equal(result.attempted, true);
      assert.ok(["job-object", "process-group"].includes(result.method));
      await process.exited;
      await waitForProcessExit(childPid);
    },
  );
});
