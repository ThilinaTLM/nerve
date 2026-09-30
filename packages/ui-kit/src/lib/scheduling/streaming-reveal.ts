/** Slowest reveal speed, so a trickling stream still reads as typing. */
export const MIN_CPS = 45;
/** Revealed text trails the received text by roughly this long. */
export const TARGET_LAG_S = 0.25;
/** Once the source is complete, drain the remaining backlog within this. */
export const DONE_FLUSH_S = 0.15;
/** Never hold back more than this many characters; older text snaps in. */
export const MAX_BACKLOG_CHARS = 1200;

/**
 * Paces how much of a growing streaming text is revealed. The rate adapts to
 * the backlog (exponential catch-up with a floor), so bursty network deltas
 * become an even per-frame reveal without drifting behind the source.
 * Pure and clock-free: the caller supplies frame deltas.
 */
export class StreamingRevealPacer {
  private shown: number;
  private target: number;
  private carry = 0;
  private done = false;
  private doneRate = 0;

  /** Starts fully revealed so remounts never replay already-visible text. */
  constructor(initialLength: number) {
    this.shown = initialLength;
    this.target = initialLength;
  }

  get shownLength(): number {
    return this.shown;
  }

  get settled(): boolean {
    return this.shown >= this.target;
  }

  setTarget(length: number, options: { done?: boolean } = {}): void {
    this.target = Math.max(0, length);
    const done = Boolean(options.done);
    // Drain linearly from the moment the source completes so the flush
    // finishes on time instead of approaching the end asymptotically.
    if (done && !this.done) {
      this.doneRate = Math.max(0, this.target - this.shown) / DONE_FLUSH_S;
    }
    this.done = done;
    if (this.shown > this.target) {
      this.shown = this.target;
      this.carry = 0;
    }
  }

  /** Reveal everything immediately (reduced motion, non-paced consumers). */
  snap(): void {
    this.shown = this.target;
    this.carry = 0;
  }

  /** Advance by one frame and return the revealed length. */
  advance(dtMs: number): number {
    if (this.settled) return this.shown;
    if (this.target - this.shown > MAX_BACKLOG_CHARS) {
      this.shown = this.target - MAX_BACKLOG_CHARS;
    }
    const backlog = this.target - this.shown;
    let rate = Math.max(MIN_CPS, backlog / TARGET_LAG_S);
    if (this.done) rate = Math.max(rate, this.doneRate);
    this.carry += (rate * Math.max(0, dtMs)) / 1000;
    const step = Math.floor(this.carry);
    this.carry -= step;
    this.shown = Math.min(this.target, this.shown + step);
    if (this.settled) this.carry = 0;
    return this.shown;
  }
}

/** Clamp a reveal length so it never splits a UTF-16 surrogate pair. */
export function revealBoundary(text: string, length: number): number {
  if (length <= 0 || length >= text.length)
    return Math.max(0, Math.min(length, text.length));
  const previous = text.charCodeAt(length - 1);
  return previous >= 0xd800 && previous <= 0xdbff ? length + 1 : length;
}
