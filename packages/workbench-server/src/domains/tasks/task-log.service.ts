import type {
  TaskLogEvent,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskOutputRetention,
  TaskRecord,
} from "@nervekit/contracts";
import { taskLogEventSchema } from "@nervekit/contracts";
import { queryTaskLogEvents } from "./task-log-query.js";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { PerformanceDiagnosticsPort } from "../../core/ports.js";
import {
  appendJsonLine,
  readJsonLines,
} from "../../infrastructure/storage/index.js";

export type TaskLogStream = "stdout" | "stderr";

export const MAX_BUFFERED_LOG_LINE_CHARS = 256 * 1024;
export const TASK_OUTPUT_HEAD_MAX_BYTES = 32 * 1024 * 1024;
export const TASK_OUTPUT_TAIL_MAX_BYTES = 512 * 1024;

export type TaskOutputTailChunk = {
  stream: TaskLogStream;
  text: string;
};

export interface TaskLogCursor {
  logSeq: number;
  lineBuffers: Record<TaskLogStream, string>;
  rawBuffers: Record<TaskLogStream, Buffer>;
  streamBytes: Record<TaskLogStream, number>;
  logQueue: Promise<void>;
  totalBytes: number;
  retainedBytes: number;
  omittedBytes: number;
  totalLines: number;
  retainedLines: number;
  omittedLines: number;
  tailChunks: TaskOutputTailChunk[];
  tailBytes: number;
  tailDirtyBytes: number;
}

export function createTaskLogCursor(logSeq = 0): TaskLogCursor {
  return {
    logSeq,
    lineBuffers: { stdout: "", stderr: "" },
    rawBuffers: { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) },
    streamBytes: { stdout: 0, stderr: 0 },
    logQueue: Promise.resolve(),
    totalBytes: 0,
    retainedBytes: 0,
    omittedBytes: 0,
    totalLines: 0,
    retainedLines: 0,
    omittedLines: 0,
    tailChunks: [],
    tailBytes: 0,
    tailDirtyBytes: 0,
  };
}

export class TaskLogService {
  constructor(
    private readonly events: StreamLogRegistry,
    private readonly options: {
      publishOutputEvents?: boolean;
      diagnostics?: PerformanceDiagnosticsPort;
    } = {},
  ) {}

  async queryLogs(
    task: TaskRecord,
    query: TaskLogQuery = {},
  ): Promise<TaskLogQueryResponse> {
    const headEvents = await this.readLogEvents(task.logsPath);
    const tailEvents = task.outputRetention?.tailPath
      ? await this.tailLogEvents(
          task,
          (headEvents.at(-1)?.seq ?? 0) +
            (task.outputRetention.truncated ? 2 : 1),
        )
      : [];
    const allEvents = task.outputRetention?.truncated
      ? [
          ...headEvents,
          omissionEvent(headEvents, task.outputRetention.omittedBytes),
          ...tailEvents,
        ]
      : [...headEvents, ...tailEvents];
    return {
      task,
      ...queryTaskLogEvents(allEvents, query),
      outputRetention: task.outputRetention,
      streamArtifacts: {
        stdoutPath: task.stdoutPath,
        stderrPath: task.stderrPath,
        eventsPath: task.logsPath,
        ...(task.combinedPath ? { combinedPath: task.combinedPath } : {}),
        fidelity: allEvents.some(
          (event) => event.raw?.fidelity === "reconstructed",
        )
          ? "reconstructed"
          : "captured",
      },
    };
  }

  async captureOutput(
    record: TaskRecord,
    cursor: TaskLogCursor,
    stream: TaskLogStream,
    chunk: Buffer | string,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    const bytes = Buffer.isBuffer(chunk)
      ? Buffer.from(chunk)
      : Buffer.from(chunk, "utf8");
    const text = bytes.toString("utf8");
    const diagnostics = this.options.diagnostics;
    const startedAt = diagnostics?.enabled ? performance.now() : undefined;
    if (diagnostics?.enabled) {
      diagnostics.count("task.outputChunk");
      diagnostics.count("task.outputBytes", Buffer.byteLength(text));
    }
    return this.enqueue(cursor, () =>
      this.captureBoundedOutputNow(record, cursor, stream, bytes, onLog),
    ).finally(() => {
      if (startedAt !== undefined)
        diagnostics?.duration(
          "task.outputCapture",
          performance.now() - startedAt,
        );
    });
  }

  async flushOutput(
    record: TaskRecord,
    cursor: TaskLogCursor,
    stream: TaskLogStream,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    return this.enqueue(cursor, () =>
      this.flushOutputNow(record, cursor, stream, onLog),
    );
  }

  async flushOutputBuffers(
    record: TaskRecord,
    cursor: TaskLogCursor,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    return this.enqueue(cursor, async () => {
      await this.flushOutputNow(record, cursor, "stdout", onLog);
      await this.flushOutputNow(record, cursor, "stderr", onLog);
      await this.persistTail(record, cursor);
    });
  }

  async persistTailSnapshot(
    record: TaskRecord,
    cursor: TaskLogCursor,
  ): Promise<void> {
    await this.enqueue(cursor, () => this.persistTail(record, cursor));
  }

  retention(record: TaskRecord, cursor: TaskLogCursor): TaskOutputRetention {
    ensureLogCursorState(cursor);
    void record;
    return {
      totalBytes: cursor.totalBytes,
      retainedBytes: cursor.totalBytes,
      omittedBytes: 0,
      totalLines: cursor.totalLines,
      retainedLines: cursor.totalLines,
      omittedLines: 0,
      headMaxBytes: TASK_OUTPUT_HEAD_MAX_BYTES,
      tailMaxBytes: TASK_OUTPUT_TAIL_MAX_BYTES,
      truncated: false,
    };
  }

  async readTail(record: TaskRecord): Promise<TaskOutputTailChunk[]> {
    void record;
    return [];
  }

  private async tailLogEvents(
    record: TaskRecord,
    firstSeq: number,
  ): Promise<TaskLogEvent[]> {
    const events: TaskLogEvent[] = [];
    let seq = firstSeq;
    for (const chunk of await this.readTail(record)) {
      for (const line of chunk.text.split(/\r?\n/)) {
        const cleaned = line.trimEnd();
        if (!cleaned) continue;
        events.push({
          seq,
          ts: record.finishedAt ?? record.updatedAt,
          stream: chunk.stream,
          level: classifyLogLevel(chunk.stream, cleaned),
          line: cleaned,
        });
        seq += 1;
      }
    }
    return events;
  }

  async latestLogSeq(logsPath: string): Promise<number> {
    const events = await this.readLogEvents(logsPath);
    return events.at(-1)?.seq ?? 0;
  }

  async readLogEvents(logsPath: string): Promise<TaskLogEvent[]> {
    const values = await readJsonLines<unknown>(logsPath).catch(() => []);
    return values
      .map((value) => taskLogEventSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data)
      .sort((a, b) => a.seq - b.seq);
  }

  private enqueue(
    cursor: TaskLogCursor,
    task: () => Promise<void>,
  ): Promise<void> {
    ensureLogCursorState(cursor);
    const queued = cursor.logQueue.catch(() => undefined).then(task);
    cursor.logQueue = queued.catch(() => undefined);
    return queued;
  }

  private async captureBoundedOutputNow(
    record: TaskRecord,
    cursor: TaskLogCursor,
    stream: TaskLogStream,
    bytes: Buffer,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    ensureLogCursorState(cursor);
    cursor.totalBytes += bytes.byteLength;
    cursor.totalLines += countOutputLines(bytes.toString("utf8"));
    cursor.retainedBytes += bytes.byteLength;
    cursor.retainedLines = cursor.totalLines;

    await mkdir(dirname(record.logsPath), { recursive: true, mode: 0o700 });
    const streamPath =
      stream === "stdout" ? record.stdoutPath : record.stderrPath;
    // Raw stream bytes are durable before the corresponding JSONL index rows.
    await appendAndSync(streamPath, bytes);
    if (record.combinedPath) {
      await appendAndSync(
        record.combinedPath,
        Buffer.concat([
          Buffer.from(`[${stream}]\n`, "utf8"),
          bytes,
          bytes.at(-1) === 0x0a ? Buffer.alloc(0) : Buffer.from("\n"),
        ]),
      );
    }
    await this.captureOutputNow(record, cursor, stream, bytes, onLog);
  }

  private async captureOutputNow(
    record: TaskRecord,
    cursor: TaskLogCursor,
    stream: TaskLogStream,
    chunk: Buffer,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    const previous = cursor.rawBuffers[stream];
    const combined = Buffer.concat([previous, chunk]);
    const combinedStart = cursor.streamBytes[stream] - previous.byteLength;
    cursor.streamBytes[stream] += chunk.byteLength;
    let position = 0;
    for (;;) {
      const newline = combined.indexOf(0x0a, position);
      if (newline < 0) break;
      const hasCr = newline > position && combined[newline - 1] === 0x0d;
      const contentEnd = hasCr ? newline - 1 : newline;
      const end = newline + 1;
      await this.emitLogLine(
        record,
        cursor,
        stream,
        combined.subarray(position, contentEnd).toString("utf8"),
        {
          start: combinedStart + position,
          end: combinedStart + end,
          terminatorBytes: hasCr ? 2 : 1,
          fidelity: "captured",
        },
        onLog,
      );
      position = end;
    }
    cursor.rawBuffers[stream] = Buffer.from(combined.subarray(position));
    cursor.lineBuffers[stream] = cursor.rawBuffers[stream].toString("utf8");
    if (cursor.lineBuffers[stream].length > MAX_BUFFERED_LOG_LINE_CHARS) {
      const raw = cursor.rawBuffers[stream];
      const start = cursor.streamBytes[stream] - raw.byteLength;
      cursor.rawBuffers[stream] = Buffer.alloc(0);
      cursor.lineBuffers[stream] = "";
      await this.emitLogLine(
        record,
        cursor,
        stream,
        raw.toString("utf8"),
        {
          start,
          end: cursor.streamBytes[stream],
          terminatorBytes: 0,
          fidelity: "captured",
        },
        onLog,
      );
    }
  }

  private async flushOutputNow(
    record: TaskRecord,
    cursor: TaskLogCursor,
    stream: TaskLogStream,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    const raw = cursor.rawBuffers[stream];
    cursor.rawBuffers[stream] = Buffer.alloc(0);
    cursor.lineBuffers[stream] = "";
    if (raw.byteLength === 0) return;
    await this.emitLogLine(
      record,
      cursor,
      stream,
      raw.toString("utf8"),
      {
        start: cursor.streamBytes[stream] - raw.byteLength,
        end: cursor.streamBytes[stream],
        terminatorBytes: 0,
        fidelity: "captured",
      },
      onLog,
    );
  }

  private async persistTail(
    record: TaskRecord,
    cursor: TaskLogCursor,
  ): Promise<void> {
    void record;
    cursor.tailDirtyBytes = 0;
  }

  private async emitLogLine(
    record: TaskRecord,
    cursor: TaskLogCursor,
    stream: TaskLogStream,
    line: string,
    raw: NonNullable<TaskLogEvent["raw"]>,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    const cleaned = line.trimEnd();
    if (cleaned.length === 0) return;

    cursor.logSeq += 1;
    const event: TaskLogEvent = {
      seq: cursor.logSeq,
      ts: new Date().toISOString(),
      stream,
      level: classifyLogLevel(stream, cleaned),
      line: cleaned,
      raw,
    };
    await appendJsonLine(record.logsPath, event, 0o600);
    this.options.diagnostics?.count("task.outputLine");
    if (this.options.publishOutputEvents !== false) {
      await this.events.publish("task.output", {
        taskId: record.id,
        stream,
        text: cleaned.slice(-16_384),
      });
      this.options.diagnostics?.count("task.outputPublication");
    }
    await onLog(event);
  }
}

async function appendAndSync(path: string, bytes: Buffer): Promise<void> {
  const file = await open(path, "a", 0o600);
  try {
    await file.write(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

function ensureLogCursorState(cursor: TaskLogCursor): void {
  cursor.lineBuffers ??= { stdout: "", stderr: "" };
  cursor.lineBuffers.stdout ??= "";
  cursor.lineBuffers.stderr ??= "";
  cursor.rawBuffers ??= { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  cursor.rawBuffers.stdout ??= Buffer.alloc(0);
  cursor.rawBuffers.stderr ??= Buffer.alloc(0);
  cursor.streamBytes ??= { stdout: 0, stderr: 0 };
  cursor.streamBytes.stdout ??= 0;
  cursor.streamBytes.stderr ??= 0;
  cursor.logQueue ??= Promise.resolve();
  cursor.totalBytes ??= 0;
  cursor.retainedBytes ??= 0;
  cursor.omittedBytes ??= 0;
  cursor.totalLines ??= 0;
  cursor.retainedLines ??= 0;
  cursor.omittedLines ??= 0;
  cursor.tailChunks ??= [];
  cursor.tailBytes ??= 0;
  cursor.tailDirtyBytes ??= 0;
}

function countOutputLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 0;
  for (const character of text) if (character === "\n") lines += 1;
  return lines;
}

const WORD_LEFT_BOUNDARY = "(?:^|[^A-Za-z0-9_-])";
const WORD_RIGHT_BOUNDARY = "(?=$|[^A-Za-z0-9_-])";
const warningPattern = new RegExp(
  `${WORD_LEFT_BOUNDARY}(warn|warning)${WORD_RIGHT_BOUNDARY}`,
  "i",
);
const stdoutErrorPattern = new RegExp(
  [
    `${WORD_LEFT_BOUNDARY}(failed|failure|exception|fatal)${WORD_RIGHT_BOUNDARY}`,
    "^\\s*(error|failed|failure|fatal)(:|\\b)",
    "^\\s*(fatal\\s+error|uncaught\\s+exception|traceback)(:|\\b)",
  ].join("|"),
  "i",
);

function omissionEvent(
  headEvents: TaskLogEvent[],
  omittedBytes: number,
): TaskLogEvent {
  const last = headEvents.at(-1);
  return {
    seq: (last?.seq ?? 0) + 1,
    ts: last?.ts ?? new Date(0).toISOString(),
    stream: "stdout",
    level: "info",
    line: `[${omittedBytes} output bytes omitted by task retention]`,
  };
}

function classifyLogLevel(
  stream: TaskLogStream,
  line: string,
): TaskLogEvent["level"] {
  if (warningPattern.test(line)) return "warn";
  if (stream === "stderr") return "error";
  if (stdoutErrorPattern.test(line)) return "error";
  return "info";
}
