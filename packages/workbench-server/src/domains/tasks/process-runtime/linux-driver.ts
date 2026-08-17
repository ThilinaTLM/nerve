import type { ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import type { TaskListeningPort, TaskRuntime } from "@nervekit/contracts";
import { errorCode, errorMessage, runCommand } from "./command.js";
import {
  managedProcessMetadata,
  observeProcessLifecycle,
  spawnShell,
  terminateManagedChild,
} from "./shell.js";
import type {
  ProcessRuntimeDriver,
  RuntimeInspection,
  TerminationResult,
} from "./types.js";

async function procIdentity(pid: number): Promise<
  | {
      state: string;
      parent: number;
      group: number;
      start: number;
    }
  | undefined
> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    const fields = stat
      .slice(close + 2)
      .trim()
      .split(/\s+/);
    return {
      state: fields[0] ?? "?",
      parent: Number(fields[1]),
      group: Number(fields[2]),
      start: Number(fields[19]),
    };
  } catch {
    return undefined;
  }
}

async function processTree(rootPid: number): Promise<Set<number>> {
  const numericEntries = (await readdir("/proc")).filter((entry) =>
    /^\d+$/.test(entry),
  );
  const parents = new Map<number, number>();
  await Promise.all(
    numericEntries.map(async (entry) => {
      const pid = Number(entry);
      const identity = await procIdentity(pid);
      if (identity) parents.set(pid, identity.parent);
    }),
  );
  const tree = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of parents) {
      if (tree.has(parent) && !tree.has(pid)) {
        tree.add(pid);
        changed = true;
      }
    }
  }
  return tree;
}

async function listeningPorts(runtime: TaskRuntime) {
  const inspection = await inspect(runtime);
  if (inspection.evidence !== "alive_verified" || !runtime.childPid) return [];
  try {
    const tree = await processTree(runtime.childPid);
    const result = await runCommand("ss", ["-ltnpH"]);
    if (result.code !== 0) return [];
    const detectedAt = new Date().toISOString();
    const listeners: TaskListeningPort[] = [];
    for (const line of result.stdout.split("\n")) {
      const pid = Number(line.match(/pid=(\d+)/)?.[1]);
      if (!tree.has(pid)) continue;
      const endpoint = line.trim().split(/\s+/)[3] ?? "";
      const match = endpoint.match(/^(.+):(\d+)$/);
      if (!match) continue;
      listeners.push({
        protocol: "tcp" as const,
        address: match[1] ?? "",
        port: Number(match[2]),
        pid,
        detectedAt,
      });
    }
    return listeners.filter(
      (listener, index) =>
        listeners.findIndex(
          (candidate) =>
            candidate.pid === listener.pid && candidate.port === listener.port,
        ) === index,
    );
  } catch {
    return [];
  }
}

async function inspect(runtime: TaskRuntime): Promise<RuntimeInspection> {
  if (runtime.platform !== "linux" || process.platform !== "linux")
    return {
      evidence: "unknown",
      detail: `Runtime belongs to ${runtime.platform}`,
    };
  if (!runtime.childPid)
    return { evidence: "unknown", detail: "Missing root PID" };
  const current = await procIdentity(runtime.childPid);
  if (!current || current.state === "Z") return { evidence: "exited_verified" };
  if (runtime.identity?.kind !== "linux")
    return {
      evidence: "unknown",
      detail: "Legacy runtime has no verifiable start identity",
    };
  if (current.start !== runtime.identity.startTimeTicks)
    return {
      evidence: "identity_mismatch",
      detail: "PID was reused by another process",
    };
  return { evidence: "alive_verified", runtime };
}

async function terminate(
  runtime: TaskRuntime,
  signal: NodeJS.Signals,
): Promise<TerminationResult> {
  const evidence = await inspect(runtime);
  if (evidence.evidence === "exited_verified")
    return { attempted: false, method: "none" };
  if (evidence.evidence !== "alive_verified")
    return { attempted: false, method: "none", error: evidence.detail };
  const pid = runtime.processGroupId
    ? -runtime.processGroupId
    : runtime.childPid;
  if (!pid)
    return {
      attempted: false,
      method: "none",
      error: "Missing process target",
    };
  const method = runtime.processGroupId ? "process-group" : "direct-child";
  try {
    process.kill(pid, signal);
    return { attempted: true, method };
  } catch (error) {
    return { attempted: true, method, error: errorMessage(error) };
  }
}

export const linuxProcessRuntimeDriver: ProcessRuntimeDriver = {
  spawn(command, options) {
    const child = spawnShell(command, options);
    const { exited, closed } = observeProcessLifecycle(child);
    if (!child.pid) throw new Error("Spawned process has no PID");
    const pid = child.pid;
    const spawnedAt = new Date().toISOString();
    const native = managedProcessMetadata(child);
    const runtime = procIdentity(pid).then((identity) => ({
      version: 2 as const,
      platform: "linux" as const,
      childPid: pid,
      processGroupId: pid,
      detached: true,
      shell: true,
      containment: native?.containment ?? "fallback",
      spawnedAt,
      identity: identity
        ? ({ kind: "linux", startTimeTicks: identity.start } as const)
        : ({ kind: "legacy_unverified" } as const),
      capabilities: {
        identity: Boolean(identity),
        processTree: true,
        listeningPorts: true,
        detail: native ? `native:${native.containment}` : undefined,
      },
    }));
    return { child, exited, closed, runtime };
  },
  inspect,
  terminate,
  async terminateChild(child: ChildProcess, signal: NodeJS.Signals) {
    const native = await terminateManagedChild(child, signal);
    if (native) return native;
    if (!child.pid)
      return { attempted: false, method: "none", error: "Missing child PID" };
    try {
      process.kill(-child.pid, signal);
      return { attempted: true, method: "process-group" };
    } catch (error) {
      if (errorCode(error) === "ESRCH")
        return { attempted: false, method: "none" };
      try {
        child.kill(signal);
        return { attempted: true, method: "direct-child" };
      } catch (fallback) {
        return {
          attempted: true,
          method: "direct-child",
          error: errorMessage(fallback),
        };
      }
    }
  },
  listeningPorts,
};
