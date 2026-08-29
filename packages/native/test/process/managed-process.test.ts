import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import {
  configureManagedProcessRuntime,
  inspectManagedTarget,
  inspectTcpListeners,
  nativeRuntimeCapabilities,
  spawnManagedProcess,
  terminateManagedTarget,
  terminateTcpListener,
} from "../../src/index.js";

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

  it("configures native admission before spawning", () => {
    configureManagedProcessRuntime({ maxActiveProcesses: 2 });
    configureManagedProcessRuntime({ maxActiveProcesses: 2 });
  });

  it("fails module initialization when the native binding is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-native-missing-"));
    const isolatedModule = join(root, "index.ts");
    try {
      await cp(new URL("../../src", import.meta.url), root, { recursive: true });
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

  it("reports best-effort resource enforcement", async () => {
    const managed = spawnManagedProcess(node, ["-e", ""], {
      policy: {
        enforcement: "best-effort",
        memoryBytes: 1024 * 1024 * 1024,
        maxCpuCores: 1,
        maxProcesses: 32,
      },
    });
    assert.deepEqual(
      managed.enforcement.map((entry) => entry.resource).sort(),
      ["cpu", "memory", "processes"],
    );
    managed.stdout.resume();
    managed.stderr.resume();
    await managed.closed;
  });

  it(
    "fails required enforcement when the configured backend is unavailable",
    { skip: process.platform !== "linux" },
    () => {
      const previous = process.env.NERVE_CGROUP_ROOT;
      process.env.NERVE_CGROUP_ROOT = join(tmpdir(), "missing-nerve-cgroup");
      try {
        assert.throws(
          () =>
            spawnManagedProcess(node, ["-e", ""], {
              policy: {
                enforcement: "required",
                maxCpuCores: 1,
              },
            }),
          /cgroup|directory/i,
        );
      } finally {
        if (previous === undefined) delete process.env.NERVE_CGROUP_ROOT;
        else process.env.NERVE_CGROUP_ROOT = previous;
      }
    },
  );

  it("rejects invalid output policies before execution", () => {
    assert.throws(
      () =>
        spawnManagedProcess(node, ["-e", ""], {
          policy: { output: { totalBytes: 1024 } },
        }),
      /overflow is required/,
    );
  });

  it("bounds queued output and resumes after a delayed consumer", async () => {
    const managed = spawnManagedProcess(
      node,
      ["-e", "process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 97))"],
      { policy: { output: { queueBytes: 32 * 1024, batchBytes: 16 * 1024 } } },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const chunks: Buffer[] = [];
    managed.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    assert.equal((await managed.closed).exitCode, 0);
    assert.equal(Buffer.concat(chunks).length, 2 * 1024 * 1024);
    assert.equal((await managed.outputStats).totalOmittedBytes, 0);
  });

  it("terminates and reports output overflow", async () => {
    const managed = spawnManagedProcess(
      node,
      ["-e", "process.stdout.write(Buffer.alloc(1024 * 1024, 97))"],
      {
        policy: {
          output: {
            queueBytes: 32 * 1024,
            batchBytes: 16 * 1024,
            totalBytes: 4096,
            overflow: "terminate",
          },
        },
      },
    );
    managed.stdout.resume();
    managed.stderr.resume();
    const exit = await managed.closed;
    assert.equal(exit.reason, "output_limit");
    const stats = await managed.outputStats;
    assert.ok(stats.totalObservedBytes > stats.totalDeliveredBytes);
    assert.equal(stats.totalDeliveredBytes, 4096);
  });

  it("truncates output while continuing to drain the child", async () => {
    const managed = spawnManagedProcess(
      node,
      ["-e", "process.stdout.write(Buffer.alloc(128 * 1024, 98))"],
      {
        policy: {
          output: {
            queueBytes: 16 * 1024,
            batchBytes: 4096,
            totalBytes: 4096,
            overflow: "truncate",
          },
        },
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    managed.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    managed.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const exit = await managed.closed;
    assert.equal(exit.exitCode, 0);
    assert.equal(exit.reason, "exited");
    assert.equal(Buffer.concat(stdout).length, 4096);
    assert.match(Buffer.concat(stderr).toString(), /output bytes omitted/);
    assert.equal((await managed.outputStats).totalOmittedBytes, 124 * 1024);
  });

  it("enforces native wall time", async () => {
    const managed = spawnManagedProcess(
      node,
      ["-e", "setInterval(() => {}, 1000)"],
      { policy: { wallTimeMs: 50 } },
    );
    managed.stdout.resume();
    managed.stderr.resume();
    assert.equal((await managed.closed).reason, "timeout");
  });

  it("rejects spawns above the native admission ceiling", async () => {
    const first = spawnManagedProcess(node, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    const second = spawnManagedProcess(node, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    assert.throws(
      () => spawnManagedProcess(node, ["-e", "setInterval(() => {}, 1000)"]),
      /capacity reached/,
    );
    await Promise.all([first.terminate(), second.terminate()]);
    await Promise.all([first.closed, second.closed]);
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

  it("discovers and identity-checks TCP listener termination", async () => {
    const managed = spawnManagedProcess(node, [
      "-e",
      "const n=require('node:net');const s=n.createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));setInterval(()=>{},1000)",
    ]);
    const port = await new Promise<number>((resolve, reject) => {
      managed.stdout.once("data", (chunk: Buffer) =>
        resolve(Number(String(chunk).trim())),
      );
      managed.stderr.once("data", (chunk: Buffer) =>
        reject(new Error(String(chunk))),
      );
    });
    const listener = inspectTcpListeners(port).find(
      (candidate) => candidate.pid === managed.pid,
    );
    assert.ok(listener);
    const stale = await terminateTcpListener(
      { ...listener, identity: `${listener.identity}-stale` },
      "SIGKILL",
    );
    assert.equal(stale.terminated, false);
    assert.match(stale.error ?? "", /identity/i);
    const terminated = await terminateTcpListener(listener, "SIGKILL");
    assert.equal(terminated.terminated, true);
    await managed.exited;
    assert.equal(
      inspectTcpListeners(port).some(
        (candidate) => candidate.pid === managed.pid,
      ),
      false,
    );
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
    "contains detached descendants according to platform guarantees",
    { timeout: 5_000 },
    async () => {
      const managed = spawnManagedProcess(node, [
        "-e",
        `const { spawn } = require("node:child_process");
       const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: process.platform === "win32" });
       console.log(child.pid);
       child.unref();`,
      ]);
      const childPid = await firstOutputNumber(managed.stdout);
      try {
        assert.equal((await managed.closed).exitCode, 0);
        assert.equal(
          await processIsAlive(childPid),
          process.platform !== "win32",
        );
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
       const child = spawn(process.execPath, ["-e", "setInterval(() => process.stdout.write('alive\\n'), 20)"], { stdio: ["ignore", "inherit", "inherit"], detached: process.platform === "win32" });
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
