import type { ChildProcess } from "node:child_process";
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

async function fingerprint(
  pid: number,
): Promise<
  | { kind: "found"; state: string; value: string }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string }
> {
  try {
    const result = await runCommand(
      "ps",
      ["-o", "state=", "-o", "lstart=", "-p", String(pid)],
      2_000,
      { LC_ALL: "C" },
    );
    if (result.code === 1 || !result.stdout.trim()) return { kind: "missing" };
    if (result.code !== 0)
      return {
        kind: "unavailable",
        detail: result.stderr || `ps exited ${result.code}`,
      };
    const line = result.stdout.trim();
    const [state = "?", ...rest] = line.split(/\s+/);
    return { kind: "found", state, value: rest.join(" ") };
  } catch (error) {
    return { kind: "unavailable", detail: errorMessage(error) };
  }
}

async function inspect(runtime: TaskRuntime): Promise<RuntimeInspection> {
  if (runtime.platform !== "darwin" || process.platform !== "darwin")
    return {
      evidence: "unknown",
      detail: `Runtime belongs to ${runtime.platform}`,
    };
  if (!runtime.childPid)
    return { evidence: "unknown", detail: "Missing root PID" };
  const current = await fingerprint(runtime.childPid);
  if (current.kind === "unavailable")
    return { evidence: "unknown", detail: current.detail };
  if (current.kind === "missing" || current.state.startsWith("Z"))
    return { evidence: "exited_verified" };
  if (runtime.identity?.kind !== "darwin")
    return {
      evidence: "unknown",
      detail: "Legacy runtime has no verifiable start identity",
    };
  if (current.value !== runtime.identity.startFingerprint)
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
  const method = runtime.processGroupId ? "process-group" : "direct-child";
  if (!pid)
    return {
      attempted: false,
      method: "none",
      error: "Missing process target",
    };
  try {
    process.kill(pid, signal);
    return { attempted: true, method };
  } catch (error) {
    return { attempted: true, method, error: errorMessage(error) };
  }
}

async function ports(runtime: TaskRuntime): Promise<TaskListeningPort[]> {
  if (
    !runtime.childPid ||
    (await inspect(runtime)).evidence !== "alive_verified"
  )
    return [];
  const result = await runCommand(
    "lsof",
    [
      "-nP",
      "-a",
      "-p",
      String(runtime.childPid),
      "-iTCP",
      "-sTCP:LISTEN",
      "-F",
      "n",
    ],
    2_000,
  ).catch(() => undefined);
  if (!result || result.code !== 0) return [];
  const now = new Date().toISOString();
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .flatMap((line) => {
      const match = /(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(line.slice(1));
      if (!match) return [];
      return [
        {
          protocol: "tcp" as const,
          address: match[1] ?? match[2] ?? "*",
          port: Number(match[3]),
          pid: runtime.childPid,
          processGroupId: runtime.processGroupId,
          detectedAt: now,
        },
      ];
    });
}

export const darwinProcessRuntimeDriver: ProcessRuntimeDriver = {
  spawn(command, options) {
    const child = spawnShell(command, options);
    const { exited, closed } = observeProcessLifecycle(child);
    if (!child.pid) throw new Error("Spawned process has no PID");
    const pid = child.pid;
    const spawnedAt = new Date().toISOString();
    const native = managedProcessMetadata(child);
    const runtime = fingerprint(pid).then((current) => ({
      version: 2 as const,
      platform: "darwin" as const,
      childPid: pid,
      processGroupId: pid,
      detached: true,
      shell: true,
      containment: native?.containment ?? "fallback",
      spawnedAt,
      identity:
        current.kind === "found"
          ? ({ kind: "darwin", startFingerprint: current.value } as const)
          : ({ kind: "legacy_unverified" } as const),
      capabilities: {
        identity: current.kind === "found",
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
  listeningPorts: ports,
};
