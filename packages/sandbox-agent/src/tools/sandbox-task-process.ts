import type { ChildProcessByStdio } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import type { Readable } from "node:stream";
import type { TaskRecord } from "@nervekit/contracts";

export async function signalSandboxRuntime(
  runtime: TaskRecord["runtime"],
  signal: NodeJS.Signals,
  descendants: ReadonlySet<number>,
  child?: ChildProcessByStdio<null, Readable, Readable>,
): Promise<void> {
  if (!runtime) return;
  if (runtime.platform !== process.platform)
    throw new Error(
      `Cannot signal task runtime from ${runtime.platform} on ${process.platform}`,
    );
  for (const pid of descendants) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (!isMissingProcess(error)) throw error;
    }
  }
  if (process.platform !== "win32" && runtime.processGroupId) {
    try {
      process.kill(-runtime.processGroupId, signal);
      return;
    } catch (error) {
      if (!isMissingProcess(error)) throw error;
    }
  }
  if (child && !child.killed) {
    child.kill(signal);
    return;
  }
  if (runtime.childPid) {
    try {
      process.kill(runtime.childPid, signal);
    } catch (error) {
      if (!isMissingProcess(error)) throw error;
    }
  }
}

export function inspectSandboxRuntime(
  runtime: TaskRecord["runtime"],
  descendants: ReadonlySet<number> = new Set<number>(),
): "running" | "exited" | "unknown" {
  if (!runtime) return "exited";
  if (runtime.platform !== process.platform) return "unknown";
  for (const pid of descendants) if (processAlive(pid)) return "running";
  if (process.platform === "linux" && runtime.processGroupId)
    return linuxProcessGroupAlive(runtime.processGroupId)
      ? "running"
      : "exited";
  const target =
    process.platform !== "win32" && runtime.processGroupId
      ? -runtime.processGroupId
      : runtime.childPid;
  if (!target) return "exited";
  try {
    process.kill(target, 0);
    return "running";
  } catch (error) {
    if (isMissingProcess(error)) return "exited";
    if (isPermissionError(error)) return "running";
    return "unknown";
  }
}

export function linuxDescendantPids(rootPid: number | undefined): number[] {
  if (process.platform !== "linux" || !rootPid) return [];
  const children = new Map<number, number[]>();
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        const close = stat.lastIndexOf(")");
        if (close < 0) continue;
        const fields = stat.slice(close + 2).split(" ");
        if (fields[0] === "Z") continue;
        const pid = Number(entry);
        const parentPid = Number(fields[1]);
        const siblings = children.get(parentPid) ?? [];
        siblings.push(pid);
        children.set(parentPid, siblings);
      } catch {
        // Processes can disappear while /proc is scanned.
      }
    }
  } catch {
    return [];
  }
  const descendants: number[] = [];
  const pending = [...(children.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (!pid) continue;
    descendants.push(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return descendants;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processAlive(pid: number): boolean {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      return close >= 0 && stat.slice(close + 2).split(" ")[0] !== "Z";
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionError(error);
  }
}

function linuxProcessGroupAlive(processGroupId: number): boolean {
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        const close = stat.lastIndexOf(")");
        if (close < 0) continue;
        const fields = stat.slice(close + 2).split(" ");
        const state = fields[0];
        const group = Number(fields[2]);
        if (group === processGroupId && state !== "Z") return true;
      } catch {
        // Processes can disappear while /proc is scanned.
      }
    }
    return false;
  } catch {
    try {
      process.kill(-processGroupId, 0);
      return true;
    } catch (error) {
      return isPermissionError(error);
    }
  }
}

function isPermissionError(error: unknown): boolean {
  return errorCode(error) === "EPERM";
}

function isMissingProcess(error: unknown): boolean {
  return errorCode(error) === "ESRCH";
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}
