import type {
  AsyncBash,
  AsyncBashLogsRequest,
  AsyncBashLogsResponse,
} from "@nervekit/contracts/core";
import type { LogStreamLine } from "$lib/presentation/logs/log-stream";

export type LogPage = AsyncBashLogsResponse["page"];
export type LogResult = AsyncBashLogsResponse;
export type LogParams = AsyncBashLogsRequest;
export const PAGE_BYTES = 64 * 1024;
export const WINDOW_BYTES = 256 * 1024;

export function mergeLogWindow(
  previous: LogPage | undefined,
  chunk: LogPage,
  earlier = false,
): LogPage {
  const budget = WINDOW_BYTES;
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
}

/** A selected-tab lifetime. Invalidated requests cannot publish or schedule work. */
export class AsyncBashLogSession {
  private generation = 0;
  private active = false;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: "tail" | "earlier";
  following = true;
  page?: LogPage;
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
    const before = this.page;
    const offset =
      mode === "tail" || !before
        ? undefined
        : mode === "earlier"
          ? Math.max(0, before.offset - PAGE_BYTES)
          : before.nextOffset;
    try {
      const result = await this.request({
        conversationId: this.conversationId,
        bashId: this.bashId,
        offset,
        limit: PAGE_BYTES,
      });
      if (!this.active || generation !== this.generation) return;
      this.bash = result.bash;
      this.page =
        mode === "tail"
          ? result.page
          : mergeLogWindow(this.page, result.page, mode === "earlier");
      // Paging back only detaches from live output once the bounded window
      // had to give up its newest bytes to make room.
      if (mode === "earlier" && trimmedTail(before, this.page))
        this.following = false;
      progressed = mode !== "append" || advanced(before, this.page);
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
            this.page !== undefined &&
            this.page.nextOffset < this.page.totalBytes;
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

function trimmedTail(before: LogPage | undefined, after: LogPage): boolean {
  return before !== undefined && after.nextOffset < before.nextOffset;
}

function advanced(before: LogPage | undefined, after: LogPage): boolean {
  return before === undefined || after.nextOffset > before.nextOffset;
}

/** A terminal shows only what follows the last carriage return of a line. */
function visibleLine(raw: string): string {
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  const carriage = line.lastIndexOf("\r");
  return carriage === -1 ? line : line.slice(carriage + 1);
}

/**
 * Project the byte window into display lines keyed by the absolute byte offset of
 * each line start, so keys (and measured heights) survive appends and trims.
 * A window starting mid-file drops its partial first line.
 */
export function asyncBashLogLines(page: LogPage | undefined): LogStreamLine[] {
  if (!page) return [];
  const encoder = new TextEncoder();
  const lines: LogStreamLine[] = [];
  const parts = page.text.split("\n");
  let offset = page.offset;
  let start = 0;
  if (page.offset > 0 && parts.length > 1) {
    offset += encoder.encode(parts[0]).length + 1;
    start = 1;
  }
  const last = parts.length - 1;
  for (let index = start; index <= last; index++) {
    const raw = parts[index]!;
    if (index === last && raw === "") break;
    lines.push({ key: `${offset}`, text: visibleLine(raw) });
    offset += encoder.encode(raw).length + 1;
  }
  return lines;
}
