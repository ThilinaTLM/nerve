import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type ApplicationLogLevel,
  type ApplicationLogRecord,
  createId,
} from "@nerve/shared";

let seq = 0;

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

function resolveDataDir(): string {
  const explicitHome = process.env.NERVE_HOME;
  return explicitHome?.trim() ? explicitHome : join(homedir(), ".nerve");
}

function serializeError(error: unknown): ApplicationLogRecord["error"] {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
