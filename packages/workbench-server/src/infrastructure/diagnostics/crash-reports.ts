import { mkdirSync, writeFileSync } from "node:fs";
import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
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

function crashesDir(dataDir: string): string {
  return join(dataDir, "crashes");
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
