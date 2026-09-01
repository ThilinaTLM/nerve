import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type DaemonFile, daemonFileSchema } from "@nervekit/contracts/status";
import { writeCrashReportSync } from "./crash-reports.js";

interface LegacyRuntimeMarker {
  pid: number;
  startedAt: string;
  lastHeartbeatAt: string;
  cleanShutdown?: boolean;
  crashReportedAt?: string;
  [key: string]: unknown;
}

export interface DaemonLeaseMonitor {
  publish(daemon: DaemonFile): Promise<void>;
  markCrashReported(crashReportPath?: string): void;
  close(): Promise<void>;
}

export async function createDaemonLeaseMonitor(
  dataDir: string,
  options: {
    heartbeatIntervalMs?: number;
    now?: () => Date;
    isProcessAlive?: (pid: number) => boolean;
  } = {},
): Promise<DaemonLeaseMonitor> {
  const path = join(dataDir, "daemon.json");
  const now = options.now ?? (() => new Date());
  const alive = options.isProcessAlive ?? isProcessAlive;
  if (inspectPreviousLease(dataDir, path, alive)) {
    throw new Error("A live Nerve daemon already owns daemon.json.");
  }
  inspectLegacyMarker(dataDir, alive);
  rmSync(path, { force: true });

  let lease: DaemonFile | undefined;
  let revision = 0;
  let writes = Promise.resolve();
  const persist = () => {
    if (!lease) return Promise.resolve();
    const snapshot = { ...lease };
    const snapshotRevision = ++revision;
    writes = writes.then(() =>
      snapshotRevision === revision
        ? atomicWrite(path, snapshot)
        : Promise.resolve(),
    );
    return writes;
  };
  const heartbeat = setInterval(() => {
    if (!lease) return;
    lease.lastHeartbeatAt = now().toISOString();
    void persist();
  }, options.heartbeatIntervalMs ?? 5_000);
  heartbeat.unref();

  return {
    async publish(daemon) {
      const previous = lease;
      lease = daemonFileSchema.parse({
        ...daemon,
        lastHeartbeatAt: now().toISOString(),
        crashReportedAt: previous?.crashReportedAt,
        crashReportPath: previous?.crashReportPath,
        argv: previous?.argv ?? process.argv.slice(1),
      });
      await persist();
    },
    markCrashReported(crashReportPath) {
      if (!lease) return;
      lease.lastHeartbeatAt = now().toISOString();
      lease.crashReportedAt = now().toISOString();
      lease.crashReportPath = crashReportPath;
      revision += 1;
      atomicWriteSync(path, lease);
    },
    async close() {
      clearInterval(heartbeat);
      await writes.catch(() => undefined);
      revision += 1;
      lease = undefined;
      rmSync(path, { force: true });
    },
  };
}

function inspectPreviousLease(
  dataDir: string,
  path: string,
  alive: (pid: number) => boolean,
): boolean {
  const previous = readJson(path);
  const parsed = daemonFileSchema.safeParse(previous);
  if (!parsed.success) return false;
  if (parsed.data.pid === process.pid || alive(parsed.data.pid)) return true;
  if (!parsed.data.crashReportedAt) {
    reportPrevious(dataDir, { ...parsed.data }, parsed.data.lastHeartbeatAt);
  }
  return false;
}

function inspectLegacyMarker(
  dataDir: string,
  alive: (pid: number) => boolean,
): void {
  const runtimePath = join(dataDir, "runtime");
  const markerPath = join(runtimePath, "orchestrator-runtime.json");
  const value = readJson(markerPath) as
    | Partial<LegacyRuntimeMarker>
    | undefined;
  if (
    value &&
    Number.isInteger(value.pid) &&
    typeof value.startedAt === "string" &&
    typeof value.lastHeartbeatAt === "string" &&
    !value.cleanShutdown &&
    !value.crashReportedAt &&
    value.pid !== process.pid &&
    !alive(value.pid as number)
  ) {
    reportPrevious(dataDir, value, value.lastHeartbeatAt);
  }
  rmSync(markerPath, { force: true });
  try {
    rmdirSync(runtimePath);
  } catch {
    // Preserve unrecognized runtime content rather than deleting it.
  }
}

function reportPrevious(
  dataDir: string,
  previous: { pid?: unknown; startedAt?: unknown; [key: string]: unknown },
  lastHeartbeatAt?: string,
): void {
  const startedAt = Date.parse(String(previous.startedAt));
  const lastSeenAt = Date.parse(lastHeartbeatAt ?? "");
  writeCrashReportSync(dataDir, {
    source: "orchestrator",
    kind: "previousUncleanExit",
    message:
      "Previous daemon process exited without graceful shutdown or crash report",
    pid: Number(previous.pid),
    uptimeMs:
      Number.isFinite(startedAt) && Number.isFinite(lastSeenAt)
        ? Math.max(0, lastSeenAt - startedAt)
        : undefined,
    context: { previousRuntime: previous },
  });
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function atomicWrite(path: string, value: DaemonFile): Promise<void> {
  atomicWriteSync(path, value);
}

function atomicWriteSync(path: string, value: DaemonFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
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
