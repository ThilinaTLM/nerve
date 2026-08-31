import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type ApplicationLogLevel,
  type ApplicationLogRecord,
} from "@nervekit/contracts/logs";
import { createId } from "@nervekit/contracts";
import { resolveDataDir } from "@nervekit/workbench-server";

let seq = 0;
let configuredApplicationLogging: boolean | undefined;

export function configureApplicationLogging(enabled: boolean): void {
  configuredApplicationLogging = enabled;
}

export function applicationLoggingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NERVE_LOGGING_ENABLED !== undefined) {
    return env.NERVE_LOGGING_ENABLED === "1";
  }
  return configuredApplicationLogging ?? false;
}

export async function desktopLog(
  level: ApplicationLogLevel,
  component: string,
  message: string,
  details: {
    context?: Record<string, unknown>;
    error?: unknown;
    durationMs?: number;
  } = {},
): Promise<void> {
  if (!applicationLoggingEnabled()) return;
  const ts = new Date().toISOString();
  seq += 1;
  const record: ApplicationLogRecord = {
    seq,
    id: createId("log"),
    ts,
    level,
    source: "desktop",
    component,
    message,
    durationMs: details.durationMs,
    context: details.context,
    error: details.error ? serializeError(details.error) : undefined,
  };
  const path = join(
    resolveDataDir(),
    "logs",
    `desktop-${ts.slice(0, 10)}.jsonl`,
  );
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

function serializeError(error: unknown): ApplicationLogRecord["error"] {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error && typeof error === "object") {
    const pretty = safeStringify(error);
    const message =
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : pretty.split("\n", 1)[0];
    return { message, stack: pretty };
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
