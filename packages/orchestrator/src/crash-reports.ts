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

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
