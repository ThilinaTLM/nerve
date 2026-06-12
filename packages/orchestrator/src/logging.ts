import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type ApplicationLogLevel,
  type ApplicationLogPruneRequest,
  type ApplicationLogPruneResponse,
  type ApplicationLogQuery,
  type ApplicationLogRecord,
  type ApplicationLogSource,
  applicationLogRecordSchema,
  createId,
} from "@nerve/shared";
import { appendJsonLine, readJsonLines, rewriteJsonLines } from "./storage.js";

export type ApplicationLogContext = Partial<
  Pick<
    ApplicationLogRecord,
    | "requestId"
    | "projectId"
    | "conversationId"
    | "agentId"
    | "runId"
    | "toolCallId"
    | "processId"
    | "workerId"
    | "durationMs"
  >
> & {
  context?: Record<string, unknown>;
  error?: unknown;
};

interface ApplicationLoggerOptions {
  dataDir: string;
  source?: ApplicationLogSource;
  component?: string;
  level?: ApplicationLogLevel;
  retentionDays?: number;
  maxBufferedLogs?: number;
  inherited?: ApplicationLogContext;
  mirrorToConsole?: boolean;
  root?: ApplicationLogger;
}

const levelRank: Record<ApplicationLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const sensitiveKeyPattern =
  /authorization|cookie|token|apikey|api_key|password|passwd|secret|credential|private.?key|nerve_daemon_token/i;

export class ApplicationLogger {
  #seq = 0;
  #buffer: ApplicationLogRecord[] = [];

  private readonly root: ApplicationLogger;
  private readonly dataDir: string;
  private readonly source: ApplicationLogSource;
  private readonly component: string;
  private readonly level: ApplicationLogLevel;
  private readonly retentionDays: number;
  private readonly maxBufferedLogs: number;
  private readonly inherited: ApplicationLogContext;
  private readonly mirrorToConsole: boolean;

  constructor(options: ApplicationLoggerOptions) {
    this.root = options.root ?? this;
    this.dataDir = options.dataDir;
    this.source = options.source ?? "orchestrator";
    this.component = options.component ?? "app";
    this.level = options.level ?? "info";
    this.retentionDays = options.retentionDays ?? 14;
    this.maxBufferedLogs = options.maxBufferedLogs ?? 2000;
    this.inherited = options.inherited ?? {};
    this.mirrorToConsole = options.mirrorToConsole ?? true;
  }

  child(
    context: ApplicationLogContext & {
      component?: string;
      source?: ApplicationLogSource;
    } = {},
  ): ApplicationLogger {
    const { component, source, ...rest } = context;
    return new ApplicationLogger({
      dataDir: this.dataDir,
      source: source ?? this.source,
      component: component ?? this.component,
      level: this.level,
      retentionDays: this.retentionDays,
      maxBufferedLogs: this.maxBufferedLogs,
      inherited: mergeContext(this.inherited, rest),
      mirrorToConsole: this.mirrorToConsole,
      root: this.root,
    });
  }

  async hydrate(): Promise<void> {
    if (this.root !== this) return this.root.hydrate();
    await mkdir(this.logsDir(), { recursive: true });
    const logs = await this.readAllLogs();
    this.#buffer = logs.slice(-this.maxBufferedLogs);
    this.#seq = logs.reduce((max, log) => Math.max(max, log.seq), 0);
  }

  async pruneRetention(): Promise<void> {
    if (this.root !== this) return this.root.pruneRetention();
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const file of await this.applicationLogFiles()) {
      const date = dateFromApplicationLogFile(file);
      if (!date || date.getTime() >= cutoff) continue;
      await rm(join(this.logsDir(), file), { force: true }).catch(
        () => undefined,
      );
    }
  }

  debug(message: string, context?: ApplicationLogContext): Promise<void> {
    return this.write("debug", message, context);
  }

  info(message: string, context?: ApplicationLogContext): Promise<void> {
    return this.write("info", message, context);
  }

  warn(message: string, context?: ApplicationLogContext): Promise<void> {
    return this.write("warn", message, context);
  }

  error(message: string, context?: ApplicationLogContext): Promise<void> {
    return this.write("error", message, context);
  }

  async withTiming<T>(
    level: ApplicationLogLevel,
    message: string,
    operation: () => Promise<T>,
    context?: ApplicationLogContext,
  ): Promise<T> {
    const started = performance.now();
    try {
      const result = await operation();
      await this.write(level, message, {
        ...context,
        durationMs: Math.round(performance.now() - started),
      });
      return result;
    } catch (error) {
      await this.error(`${message} failed`, {
        ...context,
        durationMs: Math.round(performance.now() - started),
        error,
      });
      throw error;
    }
  }

  async query(query: ApplicationLogQuery = {}): Promise<{
    logs: ApplicationLogRecord[];
    nextCursor: number;
  }> {
    const limit = query.limit ?? 100;
    let logs = await this.root.readAllLogs();
    if (query.sinceSeq !== undefined) {
      logs = logs.filter((log) => log.seq > (query.sinceSeq ?? 0));
    }
    if (query.level) logs = logs.filter((log) => log.level === query.level);
    if (query.source) logs = logs.filter((log) => log.source === query.source);
    if (query.component) {
      logs = logs.filter((log) => log.component === query.component);
    }
    for (const key of [
      "requestId",
      "projectId",
      "conversationId",
      "agentId",
      "runId",
      "toolCallId",
      "processId",
      "workerId",
    ] as const) {
      const value = query[key];
      if (value) logs = logs.filter((log) => log[key] === value);
    }
    if (query.contains) {
      const needle = query.contains.toLowerCase();
      logs = logs.filter((log) =>
        JSON.stringify(log).toLowerCase().includes(needle),
      );
    }
    const allNextCursor = logs.at(-1)?.seq ?? this.root.#seq;
    return { logs: logs.slice(-limit), nextCursor: allNextCursor };
  }

  async prune(
    query: ApplicationLogPruneRequest = {},
  ): Promise<ApplicationLogPruneResponse> {
    if (this.root !== this) return this.root.prune(query);
    if (!hasPruneFilter(query)) {
      const logs = await this.readAllLogs();
      for (const file of await this.applicationLogFiles()) {
        await rm(join(this.logsDir(), file), { force: true }).catch(
          () => undefined,
        );
      }
      this.#buffer = [];
      return { pruned: logs.length, remaining: 0 };
    }

    let pruned = 0;
    let remaining = 0;
    this.#buffer = this.#buffer.filter((log) => !matchesLogPrune(log, query));
    for (const file of await this.applicationLogFiles()) {
      const path = join(this.logsDir(), file);
      const parsed = (await readJsonLines<unknown>(path).catch(() => []))
        .map((value) => applicationLogRecordSchema.safeParse(value))
        .filter((result) => result.success)
        .map((result) => result.data);
      const kept = parsed.filter((log) => !matchesLogPrune(log, query));
      pruned += parsed.length - kept.length;
      remaining += kept.length;
      await rewriteJsonLines(path, kept, 0o600);
    }
    return { pruned, remaining };
  }

  async removeLogsForConversations(
    conversationIds: Iterable<string>,
  ): Promise<void> {
    if (this.root !== this)
      return this.root.removeLogsForConversations(conversationIds);
    const conversations = new Set(conversationIds);
    if (conversations.size === 0) return;
    this.#buffer = this.#buffer.filter(
      (log) => !log.conversationId || !conversations.has(log.conversationId),
    );
    for (const file of await this.applicationLogFiles()) {
      const path = join(this.logsDir(), file);
      const logs = await readJsonLines<unknown>(path).catch(() => []);
      const kept = logs
        .map((value) => applicationLogRecordSchema.safeParse(value))
        .filter((result) => result.success)
        .map((result) => result.data)
        .filter(
          (log) =>
            !log.conversationId || !conversations.has(log.conversationId),
        );
      await rewriteJsonLines(path, kept, 0o600);
    }
  }

  private async write(
    level: ApplicationLogLevel,
    message: string,
    context: ApplicationLogContext = {},
  ): Promise<void> {
    if (!this.shouldLog(level)) return;
    const merged = mergeContext(this.inherited, context);
    const record: ApplicationLogRecord = {
      seq: this.root.nextSeq(),
      id: createId("log"),
      ts: new Date().toISOString(),
      level,
      source: this.source,
      component: this.component,
      message,
      ...pickLogRefs(merged),
      durationMs: merged.durationMs,
      context: sanitizeContext(merged.context),
      error: merged.error ? serializeError(merged.error) : undefined,
    };
    await this.root.append(record);
    if (this.mirrorToConsole && (level === "warn" || level === "error")) {
      const line = `[${record.ts}] ${record.level.toUpperCase()} ${record.source}/${record.component}: ${record.message}`;
      if (level === "error") console.error(line, record.error ?? "");
      else console.warn(line);
    }
  }

  private shouldLog(level: ApplicationLogLevel): boolean {
    return levelRank[level] >= levelRank[this.level];
  }

  private nextSeq(): number {
    this.#seq += 1;
    return this.#seq;
  }

  private async append(record: ApplicationLogRecord): Promise<void> {
    await appendJsonLine(this.logPathFor(record.ts), record, 0o600);
    this.#buffer.push(record);
    if (this.#buffer.length > this.maxBufferedLogs) this.#buffer.shift();
  }

  private async readAllLogs(): Promise<ApplicationLogRecord[]> {
    const files = await this.applicationLogFiles();
    const values = (
      await Promise.all(
        files.map((file) =>
          readJsonLines<unknown>(join(this.logsDir(), file)).catch(() => []),
        ),
      )
    ).flat();
    return values
      .map((value) => applicationLogRecordSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data)
      .sort((a, b) => a.seq - b.seq);
  }

  private async applicationLogFiles(): Promise<string[]> {
    await mkdir(this.logsDir(), { recursive: true });
    return (await readdir(this.logsDir()))
      .filter((file) => /^application-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
      .sort();
  }

  private logPathFor(ts: string): string {
    return join(this.logsDir(), `application-${ts.slice(0, 10)}.jsonl`);
  }

  private logsDir(): string {
    return join(this.dataDir, "logs");
  }
}

export function serializeError(error: unknown): ApplicationLogRecord["error"] {
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
    if (typeof record.message === "string") {
      return {
        name: typeof record.name === "string" ? record.name : undefined,
        message: record.message,
        stack: typeof record.stack === "string" ? record.stack : undefined,
        cause: record.cause === undefined ? undefined : String(record.cause),
      };
    }
    return { message: safeStringify(error) };
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

export function sanitizeContext(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return redactValue(value, 0) as Record<string, unknown>;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) return "[Truncated]";
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sensitiveKeyPattern.test(key)
      ? "[Redacted]"
      : redactValue(child, depth + 1);
  }
  return output;
}

function mergeContext(
  base: ApplicationLogContext,
  next: ApplicationLogContext,
): ApplicationLogContext {
  return {
    ...base,
    ...next,
    context:
      base.context || next.context
        ? { ...(base.context ?? {}), ...(next.context ?? {}) }
        : undefined,
  };
}

function pickLogRefs(context: ApplicationLogContext) {
  return {
    requestId: context.requestId,
    projectId: context.projectId,
    conversationId: context.conversationId,
    agentId: context.agentId,
    runId: context.runId,
    toolCallId: context.toolCallId,
    processId: context.processId,
    workerId: context.workerId,
  };
}

function hasPruneFilter(query: ApplicationLogPruneRequest): boolean {
  return Object.values(query).some(
    (value) => value !== undefined && value !== "",
  );
}

function matchesLogPrune(
  log: ApplicationLogRecord,
  query: ApplicationLogPruneRequest,
): boolean {
  if (query.level && log.level !== query.level) return false;
  if (query.source && log.source !== query.source) return false;
  if (query.component && log.component !== query.component) return false;
  for (const key of [
    "requestId",
    "projectId",
    "conversationId",
    "agentId",
    "runId",
    "toolCallId",
    "processId",
    "workerId",
  ] as const) {
    const value = query[key];
    if (value && log[key] !== value) return false;
  }
  if (
    query.contains &&
    !JSON.stringify(log).toLowerCase().includes(query.contains.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function dateFromApplicationLogFile(file: string): Date | undefined {
  const match = /^application-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
  if (!match) return undefined;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : undefined;
}
