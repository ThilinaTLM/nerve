import { type ChildProcess, spawn } from "node:child_process";

const DEFAULT_HELPER_TIMEOUT_MS = 2000;

export interface SpawnManagedProcessOptions {
  cwd: string;
  env?: Record<string, string>;
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
  spawn(command: string, options: SpawnManagedProcessOptions): ChildProcess;
  terminate(
    child: ChildProcess,
    signal: NodeJS.Signals,
  ): Promise<TerminateProcessResult>;
}

export function spawnManagedProcess(
  command: string,
  options: SpawnManagedProcessOptions,
): ChildProcess {
  return spawn(command, {
    cwd: options.cwd,
    shell: true,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
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

export const defaultProcessSupervisor: ProcessSupervisor = {
  spawn: spawnManagedProcess,
  terminate: terminateProcess,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
