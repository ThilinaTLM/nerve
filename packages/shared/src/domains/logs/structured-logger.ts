/**
 * Minimal structured logger for long-lived services (sandbox-manager, the
 * sandbox agent daemon, and other Node processes) that log to stdout/stderr and
 * rely on the container runtime / log collector for persistence. Unlike the
 * orchestrator's file-backed application log, this logger has no storage or
 * query concerns: it emits newline-delimited JSON, gated by level, with
 * inheritable correlation bindings and key-based redaction.
 */

export type StructuredLogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<StructuredLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Free-form correlation fields attached to a log line (e.g. sandboxId, method). */
export type LogBindings = Record<string, unknown>;

/** Per-call structured context. The `err`/`error` key is serialized specially. */
export type LogContext = Record<string, unknown> & {
  err?: unknown;
  error?: unknown;
};

export type StructuredLogRecord = {
  ts: string;
  level: StructuredLogLevel;
  message: string;
  [key: string]: unknown;
};

export type LogSink = (level: StructuredLogLevel, line: string) => void;

export type StructuredLoggerOptions = {
  level?: StructuredLogLevel;
  /** Fields merged into every record, e.g. `{ source: "sandbox-manager" }`. */
  base?: LogBindings;
  /** Override the output target. Defaults to stdout, stderr for warn/error. */
  sink?: LogSink;
  /** Additional case-insensitive substrings whose values should be redacted. */
  redactKeys?: string[];
  /**
   * Tap invoked with each emitted (post-redaction) record, in addition to the
   * sink. Useful for in-memory buffers/tails. A throwing tap never breaks
   * logging. Inherited by child loggers.
   */
  onRecord?: (record: StructuredLogRecord) => void;
};

export interface StructuredLogger {
  readonly level: StructuredLogLevel;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a child logger whose bindings are merged into every record. */
  child(bindings: LogBindings): StructuredLogger;
  /** Runs `fn`, logging start (debug) and completion/failure with durationMs. */
  withTiming<T>(
    message: string,
    context: LogContext,
    fn: () => Promise<T> | T,
  ): Promise<T>;
}

const DEFAULT_REDACT_KEYS = [
  "token",
  "secret",
  "password",
  "passphrase",
  "authorization",
  "apikey",
  "api_key",
  "credential",
  "cookie",
  "privatekey",
  "private_key",
];

const REDACTED = "[REDACTED]";
const MAX_REDACT_DEPTH = 6;

export function isStructuredLogLevel(
  value: unknown,
): value is StructuredLogLevel {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  );
}

/** Coerces an arbitrary value (e.g. an env var) into a level with a fallback. */
export function resolveLogLevel(
  value: unknown,
  fallback: StructuredLogLevel = "info",
): StructuredLogLevel {
  if (typeof value === "string" && isStructuredLogLevel(value.toLowerCase()))
    return value.toLowerCase() as StructuredLogLevel;
  return fallback;
}

export function createLogger(
  options: StructuredLoggerOptions = {},
): StructuredLogger {
  const level = options.level ?? "info";
  const base = options.base ?? {};
  const sink = options.sink ?? defaultSink;
  const redactKeys = [
    ...DEFAULT_REDACT_KEYS,
    ...(options.redactKeys ?? []).map((key) => key.toLowerCase()),
  ];
  return new BaseLogger(level, base, sink, redactKeys, options.onRecord);
}

/** A logger that emits nothing; a safe default when instrumentation is optional. */
export function createNoopLogger(): StructuredLogger {
  return createLogger({ level: "error", sink: () => undefined });
}

class BaseLogger implements StructuredLogger {
  constructor(
    readonly level: StructuredLogLevel,
    private readonly base: LogBindings,
    private readonly sink: LogSink,
    private readonly redactKeys: string[],
    private readonly onRecord?: (record: StructuredLogRecord) => void,
  ) {}

  debug(message: string, context?: LogContext): void {
    this.emit("debug", message, context);
  }
  info(message: string, context?: LogContext): void {
    this.emit("info", message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.emit("warn", message, context);
  }
  error(message: string, context?: LogContext): void {
    this.emit("error", message, context);
  }

  child(bindings: LogBindings): StructuredLogger {
    return new BaseLogger(
      this.level,
      { ...this.base, ...bindings },
      this.sink,
      this.redactKeys,
      this.onRecord,
    );
  }

  async withTiming<T>(
    message: string,
    context: LogContext,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const startedAt = Date.now();
    this.debug(`${message} started`, context);
    try {
      const result = await fn();
      this.info(`${message} completed`, {
        ...context,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      this.error(`${message} failed`, {
        ...context,
        durationMs: Date.now() - startedAt,
        err: error,
      });
      throw error;
    }
  }

  private emit(
    level: StructuredLogLevel,
    message: string,
    context?: LogContext,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const record: StructuredLogRecord = {
      ts: new Date().toISOString(),
      level,
      message,
      ...this.base,
    };
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        if (value === undefined) continue;
        if (key === "err" || key === "error") {
          record.err = serializeError(value);
          continue;
        }
        record[key] = redactValue(key, value, this.redactKeys, 0);
      }
    }
    if (this.onRecord) {
      try {
        this.onRecord(record);
      } catch {
        // Never let a tap break logging.
      }
    }
    this.sink(level, safeStringify(record));
  }
}

function defaultSink(level: StructuredLogLevel, line: string): void {
  // console.error writes to stderr, console.log to stdout; both append a newline.
  if (level === "warn" || level === "error") console.error(line);
  else console.log(line);
}

function shouldRedactKey(key: string, redactKeys: string[]): boolean {
  const lower = key.toLowerCase();
  return redactKeys.some((needle) => lower.includes(needle));
}

function redactValue(
  key: string,
  value: unknown,
  redactKeys: string[],
  depth: number,
): unknown {
  if (shouldRedactKey(key, redactKeys) && value !== undefined && value !== null)
    return REDACTED;
  if (depth >= MAX_REDACT_DEPTH) return value;
  if (Array.isArray(value))
    return value.map((item) => redactValue("", item, redactKeys, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[childKey] = redactValue(childKey, childValue, redactKeys, depth + 1);
    }
    return out;
  }
  return value;
}

export function serializeError(error: unknown): {
  name?: string;
  message: string;
  stack?: string;
  cause?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause:
        error.cause === undefined
          ? undefined
          : error.cause instanceof Error
            ? error.cause.message
            : String(error.cause),
    };
  }
  return { message: typeof error === "string" ? error : safeStringify(error) };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, replaceCircular());
  } catch {
    return JSON.stringify({ message: "[unserializable log record]" });
  }
}

function replaceCircular(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
    }
    return value;
  };
}
