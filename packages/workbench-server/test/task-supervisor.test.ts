import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createTaskSupervisor,
  managedTaskShellCommand,
} from "../src/domains/tasks/task-supervisor.js";

const node = JSON.stringify(process.execPath);
let sequence = 0;

function printEnvCommand(keys: string[]): string {
  const script = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((key) => [key, process.env[key]]))))`;
  return `${node} -e ${JSON.stringify(script)}`;
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "nerve-worker-supervisor-"));
  return createTaskSupervisor(home);
}

async function collectStdout(
  command: string,
  env?: Record<string, string>,
): Promise<string> {
  const supervisor = await fixture();
  const spawned = await supervisor.spawn(command, {
    executionId: `test_${++sequence}`,
    cwd: process.cwd(),
    env,
  });
  const chunks: Buffer[] = [];
  spawned.child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  assert.equal((await spawned.closed).kind, "closed");
  return Buffer.concat(chunks).toString("utf8");
}

describe("task supervisor", () => {
  it("keeps shell and environment policy in TypeScript", async () => {
    assert.deepEqual(managedTaskShellCommand("pnpm check", process.execPath), {
      shell: process.execPath,
      args: ["-c", "pnpm check"],
    });
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

  it("persists worker containment and stable identity metadata", async () => {
    const supervisor = await fixture();
    const spawned = await supervisor.spawn("sleep 30", {
      executionId: `test_${++sequence}`,
      cwd: process.cwd(),
    });
    const runtime = await spawned.runtime;
    try {
      assert.equal(runtime.version, 3);
      assert.equal(runtime.platform, process.platform);
      assert.ok(runtime.childPid);
      assert.ok(runtime.workerExecutionId);
      assert.equal(await supervisor.isRuntimeTargetAlive(runtime), true);
    } finally {
      await supervisor.terminate(spawned.child, "SIGKILL");
      await spawned.closed;
    }
  });

  it("refuses unmanaged ChildProcess-shaped objects", async () => {
    const supervisor = await fixture();
    const child = new EventEmitter() as ChildProcess;
    const result = await supervisor.terminate(child, "SIGKILL");
    assert.equal(result.attempted, false);
    assert.match(result.error ?? "", /not owned/);
  });
});
