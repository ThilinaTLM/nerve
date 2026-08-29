import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { spawnManagedChildProcess } from "@nervekit/native";
import { forceKillProcessTree } from "../../src/execution/process/process-tree.js";

describe("process tree termination", () => {
  it("terminates a native managed process", async () => {
    const child = spawnManagedChildProcess(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    const closed = new Promise<{ signal: NodeJS.Signals | null }>((resolve) => {
      child.once("close", (_code, signal) => resolve({ signal }));
    });
    await forceKillProcessTree(child);
    const close = await closed;
    if (process.platform !== "win32") assert.equal(close.signal, "SIGKILL");
  });

  it("refuses unmanaged child processes", async () => {
    const child = new EventEmitter() as ChildProcess;
    await assert.rejects(forceKillProcessTree(child), /not owned/);
  });
});
