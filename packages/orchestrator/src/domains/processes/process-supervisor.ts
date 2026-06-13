import { type ChildProcess, spawn } from "node:child_process";

export function spawnManagedProcess(
  command: string,
  options: { cwd: string; env?: Record<string, string> },
): ChildProcess {
  return spawn(command, {
    cwd: options.cwd,
    shell: true,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

export function terminateProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to signaling the direct child below.
    }
  }
  child.kill(signal);
}
