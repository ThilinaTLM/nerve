import type {
  AsyncBash,
  AsyncBashLogsRequest,
  AsyncBashLogsResponse,
} from "@nervekit/contracts/core";
import type { LogStreamLine } from "$lib/presentation/logs/log-stream";

export type LogStream = AsyncBashLogsResponse["streams"][number];
export type LogResult = AsyncBashLogsResponse;
export type LogParams = AsyncBashLogsRequest;
export const PAGE_BYTES = 64 * 1024;
export const WINDOW_BYTES = 256 * 1024;

export function mergeLogWindow(
  current: LogStream[],
  incoming: LogStream[],
  earlier = false,
): LogStream[] {
  const budget = Math.floor(WINDOW_BYTES / Math.max(1, incoming.length));
  return incoming.map((chunk) => {
    const previous = current.find((item) => item.stream === chunk.stream);
    let merged = chunk;
    if (
      previous &&
      chunk.totalBytes >= previous.nextOffset &&
      chunk.offset <= previous.nextOffset &&
      chunk.nextOffset >= previous.offset
    ) {
      // Backend offsets are UTF-8 boundaries. Decode only the non-overlapping byte range.
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      if (chunk.offset < previous.offset) {
        const prefix = decoder.decode(
          encoder.encode(chunk.text).slice(0, previous.offset - chunk.offset),
        );
        merged = {
          ...chunk,
          text: prefix + previous.text,
          nextOffset: previous.nextOffset,
        };
      } else {
        const suffix = decoder.decode(
          encoder
            .encode(chunk.text)
            .slice(Math.max(0, previous.nextOffset - chunk.offset)),
        );
        merged = {
          ...chunk,
          text: previous.text + suffix,
          offset: previous.offset,
          nextOffset: Math.max(previous.nextOffset, chunk.nextOffset),
        };
      }
    }
    const bytes = new TextEncoder().encode(merged.text);
    if (bytes.length <= budget) return merged;
    if (earlier) {
      let end = budget;
      while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
      return {
        ...merged,
        text: new TextDecoder().decode(bytes.slice(0, end)),
        nextOffset: merged.offset + end,
      };
    }
    let start = bytes.length - budget;
    while ((bytes[start] & 0xc0) === 0x80) start++;
    return {
      ...merged,
      text: new TextDecoder().decode(bytes.slice(start)),
      offset: merged.offset + start,
    };
  });
}

/** A selected-tab lifetime. Invalidated requests cannot publish or schedule work. */
export class AsyncBashLogSession {
  private generation = 0;
  private active = false;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: "tail" | "earlier";
  following = true;
  streams: LogStream[] = [];
  bash?: AsyncBash;
  constructor(
    private conversationId: string,
    private bashId: string,
    private request: (params: LogParams) => Promise<LogResult>,
    private publish: (session: AsyncBashLogSession, error?: string) => void,
    private interval = 1000,
    initialBash?: AsyncBash,
  ) {
    this.bash = initialBash;
  }
  start() {
    this.active = true;
    void this.load("tail");
  }
  stop() {
    this.active = false;
    this.generation++;
    this.busy = false;
    this.pending = undefined;
    clearTimeout(this.timer);
  }
  async load(mode: "tail" | "append" | "earlier" = "tail") {
    if (!this.active) return;
    if (mode === "tail") {
      const changed = !this.following;
      this.following = true;
      clearTimeout(this.timer);
      if (changed) this.publish(this);
    } else if (mode === "earlier") clearTimeout(this.timer);
    else if (!this.following) return;
    if (this.busy) {
      if (mode !== "append") this.pending = mode;
      return;
    }
    clearTimeout(this.timer);
    this.busy = true;
    let progressed = false;
    const generation = this.generation;
    const before = this.streams;
    const offsets =
      mode === "tail"
        ? undefined
        : Object.fromEntries(
            this.streams.map((stream) => [
              stream.stream,
              mode === "earlier"
                ? Math.max(
                    0,
                    stream.offset -
                      Math.floor(PAGE_BYTES / Math.max(1, this.streams.length)),
                  )
                : stream.nextOffset,
            ]),
          );
    try {
      const result = await this.request({
        conversationId: this.conversationId,
        bashId: this.bashId,
        offsets,
        limit: PAGE_BYTES,
      });
      if (!this.active || generation !== this.generation) return;
      this.bash = result.bash;
      this.streams =
        mode === "tail"
          ? result.streams
          : mergeLogWindow(this.streams, result.streams, mode === "earlier");
      // Paging back only detaches from live output once the bounded window
      // had to give up its newest bytes to make room.
      if (mode === "earlier" && trimmedTail(before, this.streams))
        this.following = false;
      progressed = mode !== "append" || advanced(before, this.streams);
      this.publish(this);
    } catch (error) {
      if (this.active && generation === this.generation)
        this.publish(
          this,
          error instanceof Error ? error.message : String(error),
        );
    } finally {
      if (this.active && generation === this.generation) {
        this.busy = false;
        if (this.pending) {
          const pending = this.pending;
          this.pending = undefined;
          void this.load(pending);
        } else if (this.following) {
          // Catch up immediately while the capture is ahead of the window;
          // otherwise poll only while the command can still write.
          const behind =
            progressed &&
            this.streams.some(
              (stream) => stream.nextOffset < stream.totalBytes,
            );
          if (behind || this.bash?.status === "running")
            this.timer = setTimeout(
              () => void this.load("append"),
              behind ? 0 : this.interval,
            );
        }
      }
    }
  }
}

function trimmedTail(before: LogStream[], after: LogStream[]): boolean {
  return after.some((stream) => {
    const previous = before.find((item) => item.stream === stream.stream);
    return previous !== undefined && stream.nextOffset < previous.nextOffset;
  });
}

function advanced(before: LogStream[], after: LogStream[]): boolean {
  return after.some((stream) => {
    const previous = before.find((item) => item.stream === stream.stream);
    return previous === undefined || stream.nextOffset > previous.nextOffset;
  });
}

/** A terminal shows only what follows the last carriage return of a line. */
function visibleLine(raw: string): string {
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  const carriage = line.lastIndexOf("\r");
  return carriage === -1 ? line : line.slice(carriage + 1);
}

/**
 * Project byte windows into display lines keyed by the absolute byte offset of
 * each line start, so keys (and measured heights) survive appends and trims.
 * A window starting mid-file drops its partial first line.
 */
export function asyncBashLogLines(streams: LogStream[]): LogStreamLine[] {
  const encoder = new TextEncoder();
  const lines: LogStreamLine[] = [];
  for (const stream of streams) {
    const parts = stream.text.split("\n");
    let offset = stream.offset;
    let start = 0;
    if (stream.offset > 0 && parts.length > 1) {
      offset += encoder.encode(parts[0]).length + 1;
      start = 1;
    }
    const last = parts.length - 1;
    for (let index = start; index <= last; index++) {
      const raw = parts[index]!;
      if (index === last && raw === "") break;
      lines.push({
        key: `${stream.stream}:${offset}`,
        text: visibleLine(raw),
        ...(stream.stream === "combined"
          ? {}
          : {
              stream: stream.stream,
              tone: stream.stream === "stderr" ? ("error" as const) : undefined,
            }),
      });
      offset += encoder.encode(raw).length + 1;
    }
  }
  return lines;
}
