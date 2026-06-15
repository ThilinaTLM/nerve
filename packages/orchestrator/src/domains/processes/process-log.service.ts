import { appendFile } from "node:fs/promises";
import type {
  ProcessLogEvent,
  ProcessLogQuery,
  ProcessLogQueryResponse,
  ProcessRecord,
} from "@nerve/shared";
import { processLogEventSchema } from "@nerve/shared";
import type { EventBus } from "../../infrastructure/events/index.js";
import {
  appendJsonLine,
  readJsonLines,
} from "../../infrastructure/storage/index.js";

export type ProcessLogStream = "stdout" | "stderr";

export const MAX_BUFFERED_LOG_LINE_CHARS = 256 * 1024;

export interface ProcessLogCursor {
  logSeq: number;
  lineBuffers: Record<ProcessLogStream, string>;
  logQueue: Promise<void>;
}

export function createProcessLogCursor(logSeq = 0): ProcessLogCursor {
  return {
    logSeq,
    lineBuffers: { stdout: "", stderr: "" },
    logQueue: Promise.resolve(),
  };
}

export class ProcessLogService {
  constructor(private readonly events: EventBus) {}

  async queryLogs(
    process: ProcessRecord,
    query: ProcessLogQuery = {},
  ): Promise<ProcessLogQueryResponse> {
    const mode = query.mode ?? "recent";
    const limit = query.limit ?? 100;
    const contextLines = query.contextLines ?? 2;
    const allEvents = await this.readLogEvents(process.logsPath);
    let events = allEvents;

    if (mode === "since_cursor") {
      events = events.filter((event) => event.seq > (query.sinceSeq ?? 0));
    } else if (mode === "errors") {
      events = events.filter((event) => event.level === "error");
    } else if (mode === "warnings") {
      events = events.filter((event) => event.level === "warn");
    } else if (mode === "first_failure") {
      const index = allEvents.findIndex((event) => event.level === "error");
      events =
        index >= 0
          ? allEvents.slice(
              Math.max(0, index - contextLines),
              index + contextLines + 1,
            )
          : [];
    }

    if (query.contains) {
      const contains = query.contains.toLowerCase();
      events = events.filter((event) =>
        event.line.toLowerCase().includes(contains),
      );
    }
    if (query.regex) {
      const matcher = new RegExp(query.regex, "i");
      events = events.filter((event) => matcher.test(event.line));
    }
    if (mode !== "first_failure") events = events.slice(-limit);

    return {
      process,
      events,
      nextCursor: allEvents.at(-1)?.seq ?? 0,
      mode,
    };
  }

  async captureOutput(
    record: ProcessRecord,
    cursor: ProcessLogCursor,
    stream: ProcessLogStream,
    chunk: Buffer | string,
    onLog: (event: ProcessLogEvent) => Promise<void>,
  ): Promise<void> {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    return this.enqueue(cursor, () =>
      this.captureOutputNow(record, cursor, stream, text, onLog),
    );
  }

  async flushOutput(
    record: ProcessRecord,
    cursor: ProcessLogCursor,
    stream: ProcessLogStream,
    onLog: (event: ProcessLogEvent) => Promise<void>,
  ): Promise<void> {
    return this.enqueue(cursor, () =>
      this.flushOutputNow(record, cursor, stream, onLog),
    );
  }

  async flushOutputBuffers(
    record: ProcessRecord,
    cursor: ProcessLogCursor,
    onLog: (event: ProcessLogEvent) => Promise<void>,
  ): Promise<void> {
    return this.enqueue(cursor, async () => {
      await this.flushOutputNow(record, cursor, "stdout", onLog);
      await this.flushOutputNow(record, cursor, "stderr", onLog);
    });
  }

  async latestLogSeq(logsPath: string): Promise<number> {
    const events = await this.readLogEvents(logsPath);
    return events.at(-1)?.seq ?? 0;
  }

  async readLogEvents(logsPath: string): Promise<ProcessLogEvent[]> {
    const values = await readJsonLines<unknown>(logsPath).catch(() => []);
    return values
      .map((value) => processLogEventSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data)
      .sort((a, b) => a.seq - b.seq);
  }

  private enqueue(
    cursor: ProcessLogCursor,
    task: () => Promise<void>,
  ): Promise<void> {
    ensureLogCursorState(cursor);
    const queued = cursor.logQueue.catch(() => undefined).then(task);
    cursor.logQueue = queued.catch(() => undefined);
    return queued;
  }

  private async captureOutputNow(
    record: ProcessRecord,
    cursor: ProcessLogCursor,
    stream: ProcessLogStream,
    text: string,
    onLog: (event: ProcessLogEvent) => Promise<void>,
  ): Promise<void> {
    const path = stream === "stdout" ? record.stdoutPath : record.stderrPath;
    await appendFile(path, text, "utf8");

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
    record: ProcessRecord,
    cursor: ProcessLogCursor,
    stream: ProcessLogStream,
    onLog: (event: ProcessLogEvent) => Promise<void>,
  ): Promise<void> {
    const line = cursor.lineBuffers[stream];
    cursor.lineBuffers[stream] = "";
    if (line.length === 0) return;
    await this.emitLogLine(record, cursor, stream, line, onLog);
  }

  private async emitLogLine(
    record: ProcessRecord,
    cursor: ProcessLogCursor,
    stream: ProcessLogStream,
    line: string,
    onLog: (event: ProcessLogEvent) => Promise<void>,
  ): Promise<void> {
    const cleaned = line.trimEnd();
    if (cleaned.length === 0) return;

    cursor.logSeq += 1;
    const event: ProcessLogEvent = {
      seq: cursor.logSeq,
      ts: new Date().toISOString(),
      stream,
      level: classifyLogLevel(stream, cleaned),
      line: cleaned,
    };
    await appendJsonLine(record.logsPath, event, 0o600);
    await this.events.publish("process.log", {
      processId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      log: event,
    });
    await onLog(event);
  }
}

function ensureLogCursorState(cursor: ProcessLogCursor): void {
  cursor.lineBuffers ??= { stdout: "", stderr: "" };
  cursor.lineBuffers.stdout ??= "";
  cursor.lineBuffers.stderr ??= "";
  cursor.logQueue ??= Promise.resolve();
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

function classifyLogLevel(
  stream: ProcessLogStream,
  line: string,
): ProcessLogEvent["level"] {
  if (/\b(warn|warning)\b/i.test(line)) return "warn";
  if (
    stream === "stderr" ||
    /\b(error|failed|failure|exception|fatal)\b/i.test(line)
  )
    return "error";
  return "info";
}
