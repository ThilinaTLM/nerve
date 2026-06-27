import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ApplicationLogError,
  createId,
  type DaemonCrashReport,
  daemonCrashReportSchema,
} from "@nervekit/shared";

export type CrashReportInput = Omit<
  DaemonCrashReport,
  "id" | "ts" | "runtime" | "dataDir"
> & {
  dataDir?: string;
};

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
    const dir = join(dataDir, "crashes");
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
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") {
    const pretty = safeStringify(error);
    return {
      name:
        typeof (error as { name?: unknown }).name === "string"
          ? (error as { name: string }).name
          : undefined,
      message:
        typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : pretty.split("\n", 1)[0],
      stack:
        typeof (error as { stack?: unknown }).stack === "string"
          ? (error as { stack: string }).stack
          : pretty,
    };
  }
  return { message: String(error) };
}

function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_key, val) => {
        if (val && typeof val === "object") {
          if (seen.has(val as object)) return "[Circular]";
          seen.add(val as object);
        }
        return val;
      },
      2,
    );
  } catch {
    return String(value);
  }
}
