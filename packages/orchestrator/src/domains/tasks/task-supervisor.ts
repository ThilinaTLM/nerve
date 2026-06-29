import { type ChildProcess, spawn } from "node:child_process";
import type { TaskListeningPort, TaskRuntime } from "@nervekit/shared";
import { resolveBashShellConfig } from "@nervekit/tools";
import {
  inspectPortListeners,
  inspectRuntimeListeningPorts,
} from "./task-port-inspector.js";

const DEFAULT_HELPER_TIMEOUT_MS = 2000;

function nonInteractiveShellEnv(
  overrides: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    TERM: "dumb",
    CI: process.env.CI ?? "1",
    ...(overrides ?? {}),
  };
}

export interface SpawnManagedTaskOptions {
  cwd: string;
  env?: Record<string, string>;
  shellPath?: string;
}

export interface SpawnedManagedTask {
  child: ChildProcess;
  runtime: TaskRuntime;
}

export interface TerminateTaskOptions {
  platform?: NodeJS.Platform;
  helperTimeoutMs?: number;
  spawnCommand?: typeof spawn;
  killTask?: typeof process.kill;
}

export interface TerminateTaskResult {
  attempted: boolean;
  method: "process-group" | "direct-child" | "taskkill" | "none";
  error?: string;
}

export interface TaskSupervisor {
  spawn(command: string, options: SpawnManagedTaskOptions): SpawnedManagedTask;
  terminate(
    child: ChildProcess,
    signal: NodeJS.Signals,
  ): Promise<TerminateTaskResult>;
  terminateRuntime(
    runtime: TaskRuntime,
    signal: NodeJS.Signals,
  ): Promise<TerminateTaskResult>;
  isRuntimeTargetAlive(runtime: TaskRuntime): Promise<boolean>;
  inspectRuntimeListeningPorts(
    runtime: TaskRuntime,
  ): Promise<TaskListeningPort[]>;
  inspectPortListeners(
    ports: TaskListeningPort[],
  ): Promise<TaskListeningPort[]>;
}

export function spawnManagedTask(
  command: string,
  options: SpawnManagedTaskOptions,
): SpawnedManagedTask {
  const shellConfig = resolveBashShellConfig({ shellPath: options.shellPath });
  const child = spawn(shellConfig.shell, [...shellConfig.args, command], {
    cwd: options.cwd,
    env: nonInteractiveShellEnv(options.env),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  return { child, runtime: runtimeForChild(child, process.platform) };
}

export function runtimeForChild(
  child: Pick<ChildProcess, "pid">,
  platform: NodeJS.Platform = process.platform,
  now = new Date(),
): TaskRuntime {
  const detached = platform !== "win32";
  return {
    platform,
    childPid: child.pid,
    processGroupId: detached ? child.pid : undefined,
    detached,
    shell: true,
    spawnedAt: now.toISOString(),
  };
}

export async function terminateTask(
  child: ChildProcess,
  signal: NodeJS.Signals,
  options: TerminateTaskOptions = {},
): Promise<TerminateTaskResult> {
  const platform = options.platform ?? process.platform;
  const spawnCommand = options.spawnCommand ?? spawn;
  const killTask = options.killTask ?? process.kill;

  if (!child.pid) return signalDirectChild(child, signal);

  if (platform === "win32") {
    return terminateWindowsTaskTree(
      child.pid,
      spawnCommand,
      options.helperTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS,
    );
  }

  try {
    killTask(-child.pid, signal);
    return { attempted: true, method: "process-group" };
  } catch {
    return signalDirectChild(child, signal);
  }
}

export async function terminateTaskRuntime(
  runtime: TaskRuntime,
  signal: NodeJS.Signals,
  options: TerminateTaskOptions = {},
): Promise<TerminateTaskResult> {
  const platform = options.platform ?? process.platform;
  const spawnCommand = options.spawnCommand ?? spawn;
  const killTask = options.killTask ?? process.kill;

  if (runtime.platform !== platform) {
    return {
      attempted: false,
      method: "none",
      error: `Cannot clean up task spawned on ${runtime.platform} from ${platform}.`,
    };
  }

  if (platform === "win32") {
    if (!runtime.childPid) return missingRuntimeTargetResult(platform);
    return terminateWindowsTaskTree(
      runtime.childPid,
      spawnCommand,
      options.helperTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS,
    );
  }

  const target = nonWindowsRuntimeTarget(runtime);
  if (!target) return missingRuntimeTargetResult(platform);

  try {
    killTask(target.pid, signal);
    return { attempted: true, method: target.method };
  } catch (error) {
    return {
      attempted: true,
      method: target.method,
      error: errorMessage(error),
    };
  }
}

export async function isTaskRuntimeTargetAlive(
  runtime: TaskRuntime,
  options: TerminateTaskOptions = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const killTask = options.killTask ?? process.kill;

  if (runtime.platform !== platform) return false;
  if (platform === "win32") return false;

  const target = nonWindowsRuntimeTarget(runtime);
  if (!target) return false;

  try {
    killTask(target.pid, 0);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === "EPERM") return true;
    return false;
  }
}

export const defaultTaskSupervisor: TaskSupervisor = {
  spawn: spawnManagedTask,
  terminate: terminateTask,
  terminateRuntime: terminateTaskRuntime,
  isRuntimeTargetAlive: isTaskRuntimeTargetAlive,
  inspectRuntimeListeningPorts,
  inspectPortListeners,
};

function signalDirectChild(
  child: ChildProcess,
  signal: NodeJS.Signals,
): TerminateTaskResult {
  if (typeof child.kill !== "function") {
    return {
      attempted: false,
      method: "none",
      error: "Child task has no pid and cannot be signaled directly.",
    };
  }

  try {
    const signaled = child.kill(signal);
    return {
      attempted: true,
      method: "direct-child",
      error: signaled ? undefined : "Direct child signal returned false.",
    };
  } catch (error) {
    return {
      attempted: true,
      method: "direct-child",
      error: errorMessage(error),
    };
  }
}

function nonWindowsRuntimeTarget(
  runtime: TaskRuntime,
): { pid: number; method: "process-group" | "direct-child" } | undefined {
  if (runtime.processGroupId) {
    return { pid: -runtime.processGroupId, method: "process-group" };
  }
  if (runtime.childPid) {
    return { pid: runtime.childPid, method: "direct-child" };
  }
  return undefined;
}

function missingRuntimeTargetResult(platform: string): TerminateTaskResult {
  return {
    attempted: false,
    method: "none",
    error:
      platform === "win32"
        ? "Cannot clean up orphaned task because no child PID metadata was captured."
        : "Cannot clean up orphaned task because no process-group or child PID metadata was captured.",
  };
}

async function terminateWindowsTaskTree(
  pid: number,
  spawnCommand: typeof spawn,
  helperTimeoutMs: number,
): Promise<TerminateTaskResult> {
  let helper: ChildProcess;
  try {
    helper = spawnCommand("taskkill", ["/F", "/T", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    return {
      attempted: true,
      method: "taskkill",
      error: errorMessage(error),
    };
  }

  return new Promise<TerminateTaskResult>((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (result: TerminateTaskResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      helper.removeAllListeners("close");
      helper.removeAllListeners("error");
      resolve(result);
    };

    timeout = setTimeout(
      () => {
        let helperKillError: string | undefined;
        try {
          helper.kill("SIGKILL");
        } catch (error) {
          helperKillError = errorMessage(error);
        }
        finish({
          attempted: true,
          method: "taskkill",
          error: helperKillError
            ? `taskkill timed out after ${helperTimeoutMs}ms; failed to kill helper: ${helperKillError}`
            : `taskkill timed out after ${helperTimeoutMs}ms`,
        });
      },
      Math.max(0, helperTimeoutMs),
    );

    helper.once("error", (error) => {
      finish({
        attempted: true,
        method: "taskkill",
        error: errorMessage(error),
      });
    });
    helper.once("close", (code, closeSignal) => {
      finish({
        attempted: true,
        method: "taskkill",
        error:
          code === 0
            ? undefined
            : `taskkill exited with code ${code}${closeSignal ? ` and signal ${closeSignal}` : ""}`,
      });
    });
  });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
