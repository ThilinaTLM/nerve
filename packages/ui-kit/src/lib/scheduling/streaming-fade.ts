/** Leading lines a windowed text may drop in one update and still track. */
const MAX_DROPPED_LINES = 16;

/**
 * If `next` equals `previous` minus some whole leading lines (plus any
 * appended text), the number of dropped characters; otherwise undefined.
 */
function droppedHeadLength(previous: string, next: string): number | undefined {
  let newline = -1;
  for (let lines = 0; lines < MAX_DROPPED_LINES; lines += 1) {
    newline = previous.indexOf("\n", newline + 1);
    if (newline === -1) return undefined;
    const dropped = newline + 1;
    if (
      next.length >= previous.length - dropped &&
      next.startsWith(previous.slice(dropped))
    ) {
      return dropped;
    }
  }
  return undefined;
}

/** Fade duration for freshly revealed streaming text (ms). */
export const STREAM_FADE_MS = 220;
/** Hard cap on simultaneously fading chunks; older ones merge. */
export const MAX_FRESH_CHUNKS = 32;

export type FadeSegment = {
  /** Absolute start offset (inclusive). */
  start: number;
  /** Absolute end offset (exclusive). */
  end: number;
  fresh: boolean;
  /** Age of a fresh segment in ms; 0 for settled segments. */
  ageMs: number;
};

type FadeChunk = { start: number; end: number; at: number };

export type StreamingFadeTrackerOptions = {
  fadeMs?: number;
  /** Text already visible at creation; it never fades. */
  initialText?: string;
};

/**
 * Tracks which ranges of a growing text were revealed recently enough to be
 * fading in. Each update that extends the text records one chunk, so a
 * per-frame reveal produces roughly fadeMs / frame-time live chunks. A
 * windowed text (a code tail) may also drop whole leading lines while it
 * grows; chunks shift with it. Any other rewrite clears all chunks: nothing
 * fades on rewrite. Pure and clock-free: callers pass timestamps.
 */
export class StreamingFadeTracker {
  readonly fadeMs: number;
  private text: string;
  private chunks: FadeChunk[] = [];
  private appended: { start: number; end: number } | undefined;

  constructor(options: StreamingFadeTrackerOptions = {}) {
    this.fadeMs = options.fadeMs ?? STREAM_FADE_MS;
    this.text = options.initialText ?? "";
  }

  /** Range appended by the latest update, if it was an append. */
  get lastAppended(): { start: number; end: number } | undefined {
    return this.appended;
  }

  get freshCount(): number {
    return this.chunks.length;
  }

  /** Timestamp when the youngest chunk finishes fading, if any is live. */
  get settlesAt(): number | undefined {
    const last = this.chunks.at(-1);
    return last ? last.at + this.fadeMs : undefined;
  }

  update(text: string, now: number): void {
    const previous = this.text;
    this.text = text;
    if (text === previous) return;
    this.appended = undefined;
    let base = previous.length;
    if (!text.startsWith(previous)) {
      const shift = droppedHeadLength(previous, text);
      if (shift === undefined) {
        this.chunks = [];
        return;
      }
      this.shift(shift);
      base = previous.length - shift;
    }
    this.prune(now);
    if (text.length > base) {
      this.appended = { start: base, end: text.length };
      this.chunks.push({ start: base, end: text.length, at: now });
    }
    while (this.chunks.length > MAX_FRESH_CHUNKS) {
      // Merge the two oldest, keeping the older age: the younger part settles
      // slightly early rather than flashing back toward transparent.
      const [oldest, next] = this.chunks;
      this.chunks.splice(0, 2, {
        start: oldest!.start,
        end: next!.end,
        at: oldest!.at,
      });
    }
  }

  private shift(offset: number): void {
    this.chunks = this.chunks
      .map((chunk) => ({
        start: Math.max(0, chunk.start - offset),
        end: chunk.end - offset,
        at: chunk.at,
      }))
      .filter((chunk) => chunk.end > chunk.start);
  }

  /** Forget every chunk; the current text is treated as settled. */
  settle(): void {
    this.chunks = [];
  }

  prune(now: number): void {
    let expired = 0;
    while (
      expired < this.chunks.length &&
      now - this.chunks[expired]!.at >= this.fadeMs
    ) {
      expired += 1;
    }
    if (expired > 0) this.chunks.splice(0, expired);
  }

  /** Ordered fresh/settled segments covering [from, to). */
  segments(from: number, to: number, now: number): FadeSegment[] {
    const segments: FadeSegment[] = [];
    if (to <= from) return segments;
    let cursor = from;
    for (const chunk of this.chunks) {
      const age = now - chunk.at;
      if (age >= this.fadeMs) continue;
      const start = Math.max(chunk.start, from);
      const end = Math.min(chunk.end, to);
      if (end <= start) continue;
      if (start > cursor) {
        segments.push({ start: cursor, end: start, fresh: false, ageMs: 0 });
      }
      segments.push({ start, end, fresh: true, ageMs: Math.max(0, age) });
      cursor = end;
    }
    if (cursor < to) {
      segments.push({ start: cursor, end: to, fresh: false, ageMs: 0 });
    }
    return segments;
  }
}
