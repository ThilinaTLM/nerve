import { type ChildProcess, spawn } from "node:child_process";
import type { ProcessRuntime } from "@nerve/shared";

const DEFAULT_HELPER_TIMEOUT_MS = 2000;

export interface SpawnManagedProcessOptions {
  cwd: string;
  env?: Record<string, string>;
}

export interface SpawnedManagedProcess {
  child: ChildProcess;
  runtime: ProcessRuntime;
}

export interface TerminateProcessOptions {
  platform?: NodeJS.Platform;
  helperTimeoutMs?: number;
  spawnCommand?: typeof spawn;
  killProcess?: typeof process.kill;
}

export interface TerminateProcessResult {
  attempted: boolean;
  method: "process-group" | "direct-child" | "taskkill" | "none";
  error?: string;
}

export interface ProcessSupervisor {
  spawn(
    command: string,
    options: SpawnManagedProcessOptions,
  ): SpawnedManagedProcess;
  terminate(
    child: ChildProcess,
    signal: NodeJS.Signals,
  ): Promise<TerminateProcessResult>;
  terminateRuntime(
    runtime: ProcessRuntime,
    signal: NodeJS.Signals,
  ): Promise<TerminateProcessResult>;
  isRuntimeTargetAlive(runtime: ProcessRuntime): Promise<boolean>;
}

export function spawnManagedProcess(
  command: string,
  options: SpawnManagedProcessOptions,
): SpawnedManagedProcess {
  const child = spawn(command, {
    cwd: options.cwd,
    shell: true,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  return { child, runtime: runtimeForChild(child, process.platform) };
}

export function runtimeForChild(
  child: Pick<ChildProcess, "pid">,
  platform: NodeJS.Platform = process.platform,
  now = new Date(),
): ProcessRuntime {
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

export async function terminateProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
  options: TerminateProcessOptions = {},
): Promise<TerminateProcessResult> {
  const platform = options.platform ?? process.platform;
  const spawnCommand = options.spawnCommand ?? spawn;
  const killProcess = options.killProcess ?? process.kill;

  if (!child.pid) return signalDirectChild(child, signal);

  if (platform === "win32") {
    return terminateWindowsProcessTree(
      child.pid,
      spawnCommand,
      options.helperTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS,
    );
  }

  try {
    killProcess(-child.pid, signal);
    return { attempted: true, method: "process-group" };
  } catch {
    return signalDirectChild(child, signal);
  }
}

export async function terminateProcessRuntime(
  runtime: ProcessRuntime,
  signal: NodeJS.Signals,
  options: TerminateProcessOptions = {},
): Promise<TerminateProcessResult> {
  const platform = options.platform ?? process.platform;
  const spawnCommand = options.spawnCommand ?? spawn;
  const killProcess = options.killProcess ?? process.kill;

  if (runtime.platform !== platform) {
    return {
      attempted: false,
      method: "none",
      error: `Cannot clean up process spawned on ${runtime.platform} from ${platform}.`,
    };
  }

  if (platform === "win32") {
    if (!runtime.childPid) return missingRuntimeTargetResult(platform);
    return terminateWindowsProcessTree(
      runtime.childPid,
      spawnCommand,
      options.helperTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS,
    );
  }

  const target = nonWindowsRuntimeTarget(runtime);
  if (!target) return missingRuntimeTargetResult(platform);

  try {
    killProcess(target.pid, signal);
    return { attempted: true, method: target.method };
  } catch (error) {
    return {
      attempted: true,
      method: target.method,
      error: errorMessage(error),
    };
  }
}

export async function isProcessRuntimeTargetAlive(
  runtime: ProcessRuntime,
  options: TerminateProcessOptions = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const killProcess = options.killProcess ?? process.kill;

  if (runtime.platform !== platform) return false;
  if (platform === "win32") return false;

  const target = nonWindowsRuntimeTarget(runtime);
  if (!target) return false;

  try {
    killProcess(target.pid, 0);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === "EPERM") return true;
    return false;
  }
}

export const defaultProcessSupervisor: ProcessSupervisor = {
  spawn: spawnManagedProcess,
  terminate: terminateProcess,
  terminateRuntime: terminateProcessRuntime,
  isRuntimeTargetAlive: isProcessRuntimeTargetAlive,
};

function signalDirectChild(
  child: ChildProcess,
  signal: NodeJS.Signals,
): TerminateProcessResult {
  if (typeof child.kill !== "function") {
    return {
      attempted: false,
      method: "none",
      error: "Child process has no pid and cannot be signaled directly.",
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
  runtime: ProcessRuntime,
): { pid: number; method: "process-group" | "direct-child" } | undefined {
  if (runtime.processGroupId) {
    return { pid: -runtime.processGroupId, method: "process-group" };
  }
  if (runtime.childPid) {
    return { pid: runtime.childPid, method: "direct-child" };
  }
  return undefined;
}

function missingRuntimeTargetResult(platform: string): TerminateProcessResult {
  return {
    attempted: false,
    method: "none",
    error:
      platform === "win32"
        ? "Cannot clean up orphaned process because no child PID metadata was captured."
        : "Cannot clean up orphaned process because no process-group or child PID metadata was captured.",
  };
}

async function terminateWindowsProcessTree(
  pid: number,
  spawnCommand: typeof spawn,
  helperTimeoutMs: number,
): Promise<TerminateProcessResult> {
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

  return new Promise<TerminateProcessResult>((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (result: TerminateProcessResult) => {
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
