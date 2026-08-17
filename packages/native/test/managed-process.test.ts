import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  nativeRuntimeCapabilities,
  spawnManagedProcess,
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
  it("reports capabilities without throwing when a prebuild is unavailable", () => {
    const capabilities = nativeRuntimeCapabilities();
    assert.equal(typeof capabilities.available, "boolean");
    assert.equal(Array.isArray(capabilities.capabilities), true);
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
      assert.ok(
        ["job-object", "process-group", "taskkill"].includes(result.method),
      );
      await process.exited;
      await waitForProcessExit(childPid);
    },
  );
});
