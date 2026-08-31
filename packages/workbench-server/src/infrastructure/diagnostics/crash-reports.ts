import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type ApplicationLogError,
  type DaemonCrashReport,
  daemonCrashReportSchema,
} from "@nervekit/contracts/logs";
import { createId } from "@nervekit/contracts";

export type CrashReportInput = Omit<
  DaemonCrashReport,
  "id" | "ts" | "runtime" | "dataDir"
> & {
  dataDir?: string;
};

type RuntimeMarker = {
  pid: number;
  startedAt: string;
  lastHeartbeatAt: string;
  cleanShutdown?: boolean;
  shutdownSignal?: string;
  crashReportedAt?: string;
  crashReportPath?: string;
  argv?: string[];
};

export interface DaemonRuntimeMonitor {
  markClean: (signal?: string) => void;
  markCrashReported: (crashReportPath?: string) => void;
}

const runtimeHeartbeatIntervalMs = 5000;

export function nodeDiagnosticReportSignal(
  platform: NodeJS.Platform = process.platform,
): NodeJS.Signals | undefined {
  return platform === "win32" ? undefined : "SIGUSR2";
}

export function installNodeDiagnosticReports(
  dataDir: string,
): string | undefined {
  try {
    const dir = crashesDir(dataDir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    process.report.directory = dir;
    process.report.filename = "";
    process.report.reportOnFatalError = true;
    process.report.reportOnUncaughtException = true;
    const signal = nodeDiagnosticReportSignal();
    process.report.reportOnSignal = signal !== undefined;
    if (signal) process.report.signal = signal;
    return dir;
  } catch (error) {
    console.error("[nerve] failed to configure node diagnostic reports", error);
    return undefined;
  }
}

export interface CrashReportPruneResult {
  freedBytes: number;
  removedItems: number;
  skipped: number;
}

export async function pruneCrashReports(
  dataDir: string,
  retentionDays: number,
  now = Date.now(),
): Promise<CrashReportPruneResult> {
  const dir = crashesDir(dataDir);
  const entries = await readdir(dir, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    },
  );
  const cutoff = now - retentionDays * 86_400_000;
  let freedBytes = 0;
  let removedItems = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.isFile()) {
      skipped += 1;
      continue;
    }
    const path = join(dir, entry.name);
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      skipped += 1;
      continue;
    }
    if (!info.isFile() || info.mtimeMs >= cutoff) continue;
    try {
      await unlink(path);
      freedBytes += info.size;
      removedItems += 1;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") skipped += 1;
    }
  }
  await rmdir(dir).catch((error: unknown) => {
    const code = errorCode(error);
    if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST")
      throw error;
  });
  return { freedBytes, removedItems, skipped };
}

export function writeNodeDiagnosticReport(
  dataDir: string,
  error?: unknown,
): string | undefined {
  try {
    installNodeDiagnosticReports(dataDir);
    const reportError = error instanceof Error ? error : undefined;
    return reportError
      ? process.report.writeReport(reportError)
      : process.report.writeReport();
  } catch (reportError) {
    console.error(
      "[nerve] failed to write node diagnostic report",
      reportError,
    );
    return undefined;
  }
}

export function installDaemonRuntimeMonitor(
  dataDir: string,
): DaemonRuntimeMonitor {
  const path = runtimeMarkerPath(dataDir);
  reportPreviousUncleanExit(dataDir, path);

  const marker: RuntimeMarker = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    cleanShutdown: false,
    argv: process.argv.slice(1),
  };
  writeRuntimeMarker(path, marker);
  const heartbeat = setInterval(() => {
    marker.lastHeartbeatAt = new Date().toISOString();
    writeRuntimeMarker(path, marker);
  }, runtimeHeartbeatIntervalMs);
  heartbeat.unref();

  return {
    markClean: (signal?: string) => {
      clearInterval(heartbeat);
      marker.lastHeartbeatAt = new Date().toISOString();
      marker.cleanShutdown = true;
      marker.shutdownSignal = signal;
      writeRuntimeMarker(path, marker);
    },
    markCrashReported: (crashReportPath?: string) => {
      marker.lastHeartbeatAt = new Date().toISOString();
      marker.crashReportedAt = new Date().toISOString();
      marker.crashReportPath = crashReportPath;
      writeRuntimeMarker(path, marker);
    },
  };
}

export function writeCrashReportSync(
  dataDir: string,
  input: CrashReportInput,
): string | undefined {
  try {
    const ts = new Date().toISOString();
    const report = daemonCrashReportSchema.parse({
      id: createId("crash"),
      ts,
      dataDir,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      ...input,
    });
    const dir = crashesDir(dataDir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const safeTs = ts.replace(/[:.]/g, "-");
    const path = join(dir, `${safeTs}-${report.id}.json`);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return path;
  } catch (error) {
    console.error("[nerve] failed to write crash report", error);
    return undefined;
  }
}

export function serializeCrashError(error: unknown): ApplicationLogError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause === undefined ? undefined : String(error.cause),
    };
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      name: typeof record.name === "string" ? record.name : undefined,
      message:
        typeof record.message === "string"
          ? record.message
          : safeStringify(error),
      stack: typeof record.stack === "string" ? record.stack : undefined,
      cause: record.cause === undefined ? undefined : String(record.cause),
    };
  }
  return { message: String(error) };
}

function reportPreviousUncleanExit(dataDir: string, path: string): void {
  const previous = readRuntimeMarker(path);
  if (!previous) return;
  if (previous.cleanShutdown || previous.crashReportedAt) return;
  if (previous.pid === process.pid || isProcessAlive(previous.pid)) return;

  const lastSeenAt = Date.parse(previous.lastHeartbeatAt);
  const startedAt = Date.parse(previous.startedAt);
  const uptimeMs =
    Number.isFinite(lastSeenAt) && Number.isFinite(startedAt)
      ? Math.max(0, lastSeenAt - startedAt)
      : undefined;
  writeCrashReportSync(dataDir, {
    source: "orchestrator",
    kind: "previousUncleanExit",
    message:
      "Previous daemon process exited without graceful shutdown or crash report",
    pid: previous.pid,
    uptimeMs,
    context: { previousRuntime: previous },
  });
}

function readRuntimeMarker(path: string): RuntimeMarker | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<RuntimeMarker>;
    if (!value.pid || !value.startedAt || !value.lastHeartbeatAt)
      return undefined;
    return {
      pid: value.pid,
      startedAt: value.startedAt,
      lastHeartbeatAt: value.lastHeartbeatAt,
      cleanShutdown: value.cleanShutdown,
      shutdownSignal: value.shutdownSignal,
      crashReportedAt: value.crashReportedAt,
      crashReportPath: value.crashReportPath,
      argv: Array.isArray(value.argv) ? value.argv.map(String) : undefined,
    };
  } catch {
    return undefined;
  }
}

function writeRuntimeMarker(path: string, marker: RuntimeMarker): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    console.error("[nerve] failed to write daemon runtime marker", error);
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function crashesDir(dataDir: string): string {
  return join(dataDir, "crashes");
}

function runtimeMarkerPath(dataDir: string): string {
  return join(dataDir, "runtime", "orchestrator-runtime.json");
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
