import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import type { ChildProcess } from "node:child_process";
import {
  defaultTaskSupervisor,
  managedTaskShellCommand,
} from "../../../src/domains/tasks/application/task-supervisor.js";

const node = JSON.stringify(process.execPath);

function printEnvCommand(keys: string[]): string {
  const script = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((key) => [key, process.env[key]]))))`;
  return `${node} -e ${JSON.stringify(script)}`;
}

async function collectStdout(
  command: string,
  env?: Record<string, string>,
  cwd = tmpdir(),
): Promise<string> {
  const spawned = defaultTaskSupervisor.spawn(command, {
    cwd,
    env,
  });
  const chunks: Buffer[] = [];
  spawned.child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  assert.equal((await spawned.closed).kind, "closed");
  return Buffer.concat(chunks).toString("utf8");
}

describe("task supervisor", () => {
  it("keeps shell and environment policy in TypeScript", async () => {
    const invocation = managedTaskShellCommand("pnpm check", {
      cwd: tmpdir(),
      shellPath: process.execPath,
    });
    assert.equal(invocation.shell, process.execPath);
    assert.deepEqual(invocation.args, ["-c", "pnpm check"]);
    const output = await collectStdout(
      printEnvCommand(["PAGER", "GIT_PAGER", "GIT_TERMINAL_PROMPT", "TERM"]),
    );
    assert.deepEqual(JSON.parse(output), {
      PAGER: "cat",
      GIT_PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
      TERM: "dumb",
    });
  });

  it("applies task-provided nvm activation without changing the parent environment", async (t) => {
    if (process.platform === "win32") {
      t.skip("nvm shell activation is POSIX-only.");
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "nerve-task-nvm-"));
    const nvmDir = join(root, "nvm");
    const cwd = join(root, "project", "nested");
    await mkdir(nvmDir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(root, "project", ".nvmrc"), "24\n", "utf8");
    await writeFile(
      join(nvmDir, "nvm.sh"),
      "nvm() { export NERVE_TASK_MANAGER=nvm; return 0; }\n",
      "utf8",
    );
    delete process.env.NERVE_TASK_MANAGER;
    try {
      const output = await collectStdout(
        printEnvCommand(["NERVE_TASK_MANAGER"]),
        { NVM_DIR: nvmDir },
        cwd,
      );
      assert.deepEqual(JSON.parse(output), { NERVE_TASK_MANAGER: "nvm" });
      assert.equal(process.env.NERVE_TASK_MANAGER, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies an executable project environment adapter to tasks", async (t) => {
    if (process.platform === "win32") {
      t.skip("Executable fixture scripts use POSIX shebangs.");
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "nerve-task-direnv-"));
    const executable = join(root, "direnv");
    await writeFile(join(root, ".envrc"), "export TASK_ENV=1\n", "utf8");
    await writeFile(
      executable,
      `#!${process.execPath}\nconst { spawnSync } = require('node:child_process'); process.env.NERVE_TASK_MANAGER = 'direnv'; const result = spawnSync(process.argv[4], process.argv.slice(5), { env: process.env, stdio: 'inherit' }); process.exit(result.status ?? 1);`,
      "utf8",
    );
    await chmod(executable, 0o755);
    try {
      const output = await collectStdout(
        printEnvCommand(["NERVE_TASK_MANAGER"]),
        { PATH: `${root}${delimiter}${process.env.PATH ?? ""}` },
        root,
      );
      assert.deepEqual(JSON.parse(output), { NERVE_TASK_MANAGER: "direnv" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists native containment and stable identity metadata", async () => {
    const spawned = defaultTaskSupervisor.spawn(
      `${node} -e ${JSON.stringify("setInterval(() => {}, 1000)")}`,
      { cwd: tmpdir() },
    );
    const runtime = await spawned.runtime;
    try {
      assert.equal(runtime.version, 2);
      assert.equal(runtime.platform, process.platform);
      assert.ok(runtime.childPid);
      assert.notEqual(runtime.identity?.kind, "legacy_unverified");
      assert.equal(
        await defaultTaskSupervisor.isRuntimeTargetAlive(runtime),
        true,
      );
    } finally {
      await defaultTaskSupervisor.terminate(spawned.child, "SIGKILL");
      await spawned.closed;
    }
  });

  it("refuses unmanaged ChildProcess-shaped objects", async () => {
    const child = new EventEmitter() as ChildProcess;
    const result = await defaultTaskSupervisor.terminate(child, "SIGKILL");
    assert.equal(result.attempted, false);
    assert.match(result.error ?? "", /not owned/);
  });
});
