import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { TaskRecord } from "@nervekit/contracts";
import { SandboxStateStores } from "../src/state/sandbox-state.js";
import { SandboxTaskService } from "../src/tools/sandbox-task-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("sandbox TaskService adapter", () => {
  it("orphans and cancels a live persisted runtime without a child handle", async () => {
    if (process.platform === "win32") return;
    const root = await temporaryRoot();
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const child = spawn("/bin/sh", ["-lc", "sleep 30"], {
      cwd: workspace,
      detached: true,
      stdio: "ignore",
    });
    assert.ok(child.pid);
    const task = persistedTask(root, workspace, child.pid);
    await writePersistedTask(root, task);

    try {
      const service = await createService(root, workspace);
      assert.equal((await service.get(task.id))?.status, "orphaned");

      const cancelled = await service.cancel(task.id);
      assert.equal(cancelled.status, "cancelled");
      assert.equal(runtimeAlive(-child.pid), false);
      await service.drain();
    } finally {
      killGroup(child.pid);
    }
  });

  it("cancellation terminates the sandbox process group and descendants", async () => {
    if (process.platform === "win32") return;
    const root = await temporaryRoot();
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const service = await createService(root, workspace);
    const task = await service.start({
      cwd: workspace,
      command: "sleep 30 & child=$!; echo $child; wait $child",
    });
    const descendantPid = await waitForLoggedPid(service, task.id);
    assert.equal(runtimeAlive(descendantPid), true);
    if (process.platform === "linux") {
      assert.ok(task.runtime?.childPid);
      assert.equal(
        linuxProcessGroup(task.runtime.childPid),
        task.runtime.processGroupId,
      );
    }

    const cancelled = await service.cancel(task.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(runtimeAlive(-(task.runtime?.processGroupId ?? 0)), false);
    assert.equal(runtimeAlive(descendantPid), false);
    await service.drain();
  });

  it("persists sandbox launch environments for restart", async () => {
    const root = await temporaryRoot();
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const service = await createService(root, workspace);
    const first = await service.start({
      cwd: workspace,
      command: 'printf "%s\\n" "$NERVE_TASK_ENV"',
      env: { NERVE_TASK_ENV: "preserved" },
    });
    const completed = await waitForTerminal(service, first.id);
    assert.equal(completed.envInfo?.persisted, true);

    const restarted = await service.restart(first.id);
    await waitForTerminal(service, restarted.id);
    const logs = await service.logs(restarted.id, { mode: "recent" });
    assert.ok(logs.events.some((event) => event.line === "preserved"));
    assert.equal(restarted.restartedFromTaskId, first.id);
    await service.drain();
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nerve-sandbox-task-"));
  roots.push(root);
  return root;
}

async function createService(
  root: string,
  workspace: string,
): Promise<SandboxTaskService> {
  const stores = new SandboxStateStores(root);
  await stores.load();
  const service = new SandboxTaskService({
    stateDir: root,
    workspaceDir: workspace,
    events: stores.events,
  });
  await service.load();
  return service;
}

function persistedTask(
  root: string,
  workspace: string,
  pid: number,
): TaskRecord {
  const id = "task_persisted_runtime";
  const dir = path.join(root, "tasks", id);
  const now = new Date().toISOString();
  return {
    id,
    cwd: workspace,
    command: "sleep 30",
    status: "running",
    readiness: { outcome: "none" },
    stdoutPath: path.join(dir, "stdout.log"),
    stderrPath: path.join(dir, "stderr.log"),
    combinedPath: path.join(dir, "logs.txt"),
    logsPath: path.join(dir, "logs.jsonl"),
    startedAt: now,
    updatedAt: now,
    runtime: {
      platform: process.platform,
      childPid: pid,
      processGroupId: pid,
      detached: true,
      shell: true,
      spawnedAt: now,
    },
    origin: { kind: "api" },
    visibility: "background",
  };
}

async function writePersistedTask(
  root: string,
  task: TaskRecord,
): Promise<void> {
  const dir = path.join(root, "tasks", task.id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "state.json"),
    `${JSON.stringify({ task, logEvents: [], truncated: false })}\n`,
  );
  await writeFile(path.join(dir, "logs.txt"), "");
}

async function waitForLoggedPid(
  service: SandboxTaskService,
  taskId: string,
): Promise<number> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const logs = await service.logs(taskId, { mode: "recent" });
    const value = Number(logs.events.at(-1)?.line);
    if (Number.isInteger(value) && value > 0) return value;
    await delay(10);
  }
  throw new Error("Timed out waiting for descendant PID");
}

async function waitForTerminal(
  service: SandboxTaskService,
  taskId: string,
): Promise<TaskRecord> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const task = await service.get(taskId);
    if (
      task &&
      ["completed", "failed", "cancelled", "timed_out"].includes(task.status)
    )
      return task;
    await delay(10);
  }
  throw new Error(`Timed out waiting for terminal task ${taskId}`);
}

function linuxProcessGroup(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return undefined;
    return Number(stat.slice(close + 2).split(" ")[2]);
  } catch {
    return undefined;
  }
}

function runtimeAlive(pid: number): boolean {
  if (!pid) return false;
  if (process.platform === "linux" && pid > 0) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      if (close >= 0 && stat.slice(close + 2).split(" ")[0] === "Z")
        return false;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ESRCH"
    )
      return false;
    throw error;
  }
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
