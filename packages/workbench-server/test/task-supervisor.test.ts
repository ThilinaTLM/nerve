import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { ChildProcess } from "node:child_process";
import {
  defaultTaskSupervisor,
  managedTaskShellCommand,
} from "../src/domains/tasks/task-supervisor.js";

const node = JSON.stringify(process.execPath);

function printEnvCommand(keys: string[]): string {
  const script = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((key) => [key, process.env[key]]))))`;
  return `${node} -e ${JSON.stringify(script)}`;
}

async function collectStdout(
  command: string,
  env?: Record<string, string>,
): Promise<string> {
  const spawned = defaultTaskSupervisor.spawn(command, {
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

  it("persists native containment and stable identity metadata", async () => {
    const spawned = defaultTaskSupervisor.spawn(
      `${node} -e ${JSON.stringify("setInterval(() => {}, 1000)")}`,
      { cwd: process.cwd() },
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
