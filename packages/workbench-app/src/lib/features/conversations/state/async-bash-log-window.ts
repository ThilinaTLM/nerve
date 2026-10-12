import type {
  AsyncBash,
  AsyncBashLogsRequest,
  AsyncBashLogsResponse,
} from "@nervekit/contracts/core";

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
    if (mode !== "append") {
      const following = mode === "tail";
      const changed = this.following !== following;
      this.following = following;
      clearTimeout(this.timer);
      if (changed) this.publish(this);
    } else if (!this.following) return;
    if (this.busy) {
      if (mode !== "append") this.pending = mode;
      return;
    }
    clearTimeout(this.timer);
    this.busy = true;
    const generation = this.generation;
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
        } else if (this.following && this.bash?.status === "running")
          this.timer = setTimeout(
            () => void this.load("append"),
            this.interval,
          );
      }
    }
  }
}
