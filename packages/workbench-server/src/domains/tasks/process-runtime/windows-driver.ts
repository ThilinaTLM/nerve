import type { ChildProcess } from "node:child_process";
import type { TaskListeningPort, TaskRuntime } from "@nervekit/contracts";
import { errorMessage, runCommand } from "./command.js";
import { observeProcessLifecycle, spawnShell } from "./shell.js";
import type {
  ProcessRuntimeDriver,
  RuntimeInspection,
  TerminationResult,
} from "./types.js";

async function creationDate(
  pid: number,
): Promise<
  | { kind: "found"; value: string }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string }
> {
  const script = `$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){$p.CreationDate.ToUniversalTime().ToString('o')}`;
  try {
    const result = await runCommand(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      3_000,
    );
    if (result.code !== 0)
      return {
        kind: "unavailable",
        detail: result.stderr || `CIM query exited ${result.code}`,
      };
    const value = result.stdout.trim();
    return value ? { kind: "found", value } : { kind: "missing" };
  } catch (error) {
    return { kind: "unavailable", detail: errorMessage(error) };
  }
}

async function inspect(runtime: TaskRuntime): Promise<RuntimeInspection> {
  if (runtime.platform !== "win32" || process.platform !== "win32")
    return {
      evidence: "unknown",
      detail: `Runtime belongs to ${runtime.platform}`,
    };
  if (!runtime.childPid)
    return { evidence: "unknown", detail: "Missing root PID" };
  const current = await creationDate(runtime.childPid);
  if (current.kind === "unavailable")
    return { evidence: "unknown", detail: current.detail };
  if (current.kind === "missing") return { evidence: "exited_verified" };
  if (runtime.identity?.kind !== "win32")
    return {
      evidence: "unknown",
      detail: "Legacy runtime has no verifiable creation time",
    };
  if (current.value !== runtime.identity.creationDate)
    return {
      evidence: "identity_mismatch",
      detail: "PID was reused by another process",
    };
  return { evidence: "alive_verified", runtime };
}

async function terminateVerified(
  runtime: TaskRuntime,
  signal: NodeJS.Signals,
): Promise<TerminationResult> {
  const args =
    signal === "SIGKILL"
      ? ["/F", "/T", "/PID", String(runtime.childPid)]
      : ["/T", "/PID", String(runtime.childPid)];
  const result = await runCommand("taskkill", args, 5_000).catch((error) => ({
    code: -1,
    stdout: "",
    stderr: errorMessage(error),
  }));
  const stopped = result.code === 0 || result.code === 128;
  return {
    attempted: true,
    method: "taskkill",
    error: stopped
      ? undefined
      : result.stderr || `taskkill exited ${result.code}`,
  };
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
  return terminateVerified(evidence.runtime, signal);
}

async function listeningPorts(
  runtime: TaskRuntime,
): Promise<TaskListeningPort[]> {
  if (
    !runtime.childPid ||
    (await inspect(runtime)).evidence !== "alive_verified"
  )
    return [];
  const script = `Get-NetTCPConnection -State Listen -OwningProcess ${runtime.childPid} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress`;
  const result = await runCommand(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    3_000,
  ).catch(() => undefined);
  if (!result || result.code !== 0 || !result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout) as
      | { LocalAddress: string; LocalPort: number; OwningProcess: number }
      | Array<{
          LocalAddress: string;
          LocalPort: number;
          OwningProcess: number;
        }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const detectedAt = new Date().toISOString();
    return rows.map((row) => ({
      protocol: row.LocalAddress.includes(":") ? "tcp6" : "tcp",
      address: row.LocalAddress,
      port: row.LocalPort,
      pid: row.OwningProcess,
      detectedAt,
    }));
  } catch {
    return [];
  }
}

export const windowsProcessRuntimeDriver: ProcessRuntimeDriver = {
  spawn(command, options) {
    const child = spawnShell(command, options);
    const { exited, closed } = observeProcessLifecycle(child);
    if (!child.pid) throw new Error("Spawned process has no PID");
    const pid = child.pid;
    const spawnedAt = new Date().toISOString();
    const runtime = creationDate(pid).then((created) => ({
      version: 2 as const,
      platform: "win32" as const,
      childPid: pid,
      detached: false,
      shell: true,
      spawnedAt,
      identity:
        created.kind === "found"
          ? ({ kind: "win32", creationDate: created.value } as const)
          : ({ kind: "legacy_unverified" } as const),
      capabilities: {
        identity: created.kind === "found",
        processTree: true,
        listeningPorts: true,
      },
    }));
    return { child, exited, closed, runtime };
  },
  inspect,
  terminate,
  async terminateChild(child: ChildProcess, signal: NodeJS.Signals) {
    if (!child.pid)
      return { attempted: false, method: "none", error: "Missing child PID" };
    const created = await creationDate(child.pid);
    if (created.kind === "missing") return { attempted: false, method: "none" };
    if (created.kind === "unavailable") {
      const stopped = child.kill(signal);
      return {
        attempted: stopped,
        method: "direct-child",
        error: stopped ? undefined : created.detail,
      };
    }
    return terminateVerified(
      {
        version: 2,
        platform: "win32",
        childPid: child.pid,
        detached: false,
        shell: true,
        spawnedAt: new Date().toISOString(),
        identity: { kind: "win32", creationDate: created.value },
      },
      signal,
    );
  },
  listeningPorts,
};
