import type { ApplicationLogLevel } from "@nerve/shared";

type ClientLog = {
  level: ApplicationLogLevel;
  component: string;
  message: string;
  ts?: string;
  durationMs?: number;
  context?: Record<string, unknown>;
  error?: { name?: string; message: string; stack?: string };
};

const queue: ClientLog[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let installed = false;
let flushing = false;
let flushRetryDelayMs = 1_000;
const NORMAL_FLUSH_DELAY_MS = 500;
const MAX_FLUSH_RETRY_DELAY_MS = 10_000;

export function installClientLogging(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    clientLog("error", "web-runtime", "Unhandled browser error", {
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      error: event.error ?? event.message,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    clientLog("error", "web-runtime", "Unhandled promise rejection", {
      error: event.reason,
    });
  });
}

export function clientLog(
  level: ApplicationLogLevel,
  component: string,
  message: string,
  details: {
    durationMs?: number;
    context?: Record<string, unknown>;
    error?: unknown;
  } = {},
): void {
  queue.push({
    level,
    component,
    message,
    ts: new Date().toISOString(),
    durationMs: details.durationMs,
    context: details.context,
    error: details.error ? serializeError(details.error) : undefined,
  });
  if (queue.length > 200) queue.splice(0, queue.length - 200);
  scheduleFlush();
}

export function logApiFailure(
  method: string,
  path: string,
  status: number | undefined,
  durationMs: number,
  error: unknown,
): void {
  clientLog(
    status && status < 500 ? "warn" : "error",
    "api",
    "API request failed",
    {
      durationMs,
      context: { method, path, status },
      error,
    },
  );
}

function scheduleFlush(delayMs = NORMAL_FLUSH_DELAY_MS): void {
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushLogs();
  }, delayMs);
}

async function flushLogs(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const logs = queue.splice(0, 50);
  let nextDelayMs = NORMAL_FLUSH_DELAY_MS;
  try {
    const response = await fetch("/api/logs/client", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ logs }),
    });
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}`);
    flushRetryDelayMs = 1_000;
  } catch (error) {
    queue.unshift(...logs);
    if (queue.length > 200) queue.splice(0, queue.length - 200);
    nextDelayMs = flushRetryDelayMs;
    flushRetryDelayMs = Math.min(
      flushRetryDelayMs * 2,
      MAX_FLUSH_RETRY_DELAY_MS,
    );
    console.warn("Failed to submit Nerve client logs", error);
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush(nextDelayMs);
  }
}

export function serializeError(error: unknown): ClientLog["error"] {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
