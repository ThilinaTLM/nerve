import type {
  TaskLogEvent,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskOutputRetention,
  TaskRecord,
} from "@nervekit/contracts";
import { taskLogEventSchema } from "@nervekit/contracts";
import { queryTaskLogEvents } from "./task-log-query.js";
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
    };
  }

  async captureOutput(
    record: TaskRecord,
    cursor: TaskLogCursor,
    stream: TaskLogStream,
    chunk: Buffer | string,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    const diagnostics = this.options.diagnostics;
    const startedAt = diagnostics?.enabled ? performance.now() : undefined;
    if (diagnostics?.enabled) {
      diagnostics.count("task.outputChunk");
      diagnostics.count("task.outputBytes", Buffer.byteLength(text));
    }
    return this.enqueue(cursor, () =>
      this.captureBoundedOutputNow(record, cursor, stream, text, onLog),
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
    text: string,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    ensureLogCursorState(cursor);
    const bytes = Buffer.byteLength(text);
    const lines = countOutputLines(text);
    cursor.totalBytes += bytes;
    cursor.totalLines += lines;
    cursor.retainedBytes += bytes;
    cursor.retainedLines += lines;
    await this.captureOutputNow(record, cursor, stream, text, onLog);
  }

  private async captureOutputNow(
    record: TaskRecord,
    cursor: TaskLogCursor,
    stream: TaskLogStream,
    text: string,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    const { lines, remainder } = appendChunkAndTakeCompleteLines(
      cursor.lineBuffers[stream],
      text,
    );
    cursor.lineBuffers[stream] = remainder;

    for (const line of lines) {
      await this.emitLogLine(record, cursor, stream, line, onLog);
    }

    if (cursor.lineBuffers[stream].length > MAX_BUFFERED_LOG_LINE_CHARS) {
      const overlongLine = cursor.lineBuffers[stream];
      cursor.lineBuffers[stream] = "";
      await this.emitLogLine(record, cursor, stream, overlongLine, onLog);
    }
  }

  private async flushOutputNow(
    record: TaskRecord,
    cursor: TaskLogCursor,
    stream: TaskLogStream,
    onLog: (event: TaskLogEvent) => Promise<void>,
  ): Promise<void> {
    const line = cursor.lineBuffers[stream];
    cursor.lineBuffers[stream] = "";
    if (line.length === 0) return;
    await this.emitLogLine(record, cursor, stream, line, onLog);
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

function ensureLogCursorState(cursor: TaskLogCursor): void {
  cursor.lineBuffers ??= { stdout: "", stderr: "" };
  cursor.lineBuffers.stdout ??= "";
  cursor.lineBuffers.stderr ??= "";
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

function appendChunkAndTakeCompleteLines(
  previous: string,
  chunk: string,
): { lines: string[]; remainder: string } {
  const combined = previous + chunk;
  if (combined.length === 0) return { lines: [], remainder: "" };

  const parts = combined.split(/\r?\n/);
  if (combined.endsWith("\n")) {
    return { lines: parts.slice(0, -1), remainder: "" };
  }
  return { lines: parts.slice(0, -1), remainder: parts.at(-1) ?? "" };
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
