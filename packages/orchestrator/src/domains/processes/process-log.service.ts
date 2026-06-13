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

export interface ProcessLogCursor {
  logSeq: number;
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
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
    onLog: (event: ProcessLogEvent) => Promise<void>,
  ): Promise<void> {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    const path = stream === "stdout" ? record.stdoutPath : record.stderrPath;
    await appendFile(path, text, "utf8");
    for (const line of splitLines(text)) {
      cursor.logSeq += 1;
      const event: ProcessLogEvent = {
        seq: cursor.logSeq,
        ts: new Date().toISOString(),
        stream,
        level: classifyLogLevel(stream, line),
        line,
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
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function classifyLogLevel(
  stream: "stdout" | "stderr",
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
