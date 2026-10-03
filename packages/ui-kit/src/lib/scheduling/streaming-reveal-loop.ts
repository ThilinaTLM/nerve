import {
  StreamingRevealPacer,
  type StreamingRevealPacerOptions,
} from "./streaming-reveal.js";

export type RevealFrameScheduler<Handle = number> = {
  request: (callback: (timestamp: number) => void) => Handle;
  cancel: (handle: Handle) => void;
};

export type StreamingRevealLoopOptions<Handle = number> = {
  /** Called with the newly revealed length whenever it changes. */
  onReveal: (length: number) => void;
  /** Called once each time a running loop catches up with its target. */
  onSettled?: () => void;
  /** Frame source; defaults to requestAnimationFrame when available. */
  frames?: RevealFrameScheduler<Handle>;
  /** Pacing options forwarded to the pacer. */
  pacer?: StreamingRevealPacerOptions;
};

const FALLBACK_FRAME_MS = 1000 / 60;

function defaultFrames(): RevealFrameScheduler | undefined {
  if (typeof requestAnimationFrame !== "function") return undefined;
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  };
}

/**
 * Drives a `StreamingRevealPacer` from animation frames. The loop only runs
 * while the revealed length trails its target, so settled consumers cost
 * nothing. Without a frame source (SSR, tests) targets reveal immediately.
 */
export class StreamingRevealLoop<Handle = number> {
  private readonly pacer: StreamingRevealPacer;
  private readonly frames: RevealFrameScheduler<Handle> | undefined;
  private frame: Handle | undefined;
  private lastTimestamp: number | undefined;
  private emitted: number;
  private destroyed = false;

  constructor(
    initialLength: number,
    private readonly options: StreamingRevealLoopOptions<Handle>,
  ) {
    this.pacer = new StreamingRevealPacer(initialLength, options.pacer);
    this.emitted = initialLength;
    this.frames =
      options.frames ??
      (defaultFrames() as RevealFrameScheduler<Handle> | undefined);
  }

  get shownLength(): number {
    return this.pacer.shownLength;
  }

  get settled(): boolean {
    return this.pacer.settled;
  }

  /** Update the source length and start pacing toward it when behind. */
  setTarget(length: number, options: { done?: boolean } = {}): void {
    if (this.destroyed) return;
    this.pacer.setTarget(length, options);
    if (!this.frames) {
      this.snap();
      return;
    }
    if (this.pacer.settled) return;
    this.schedule();
  }

  /** Reveal the current (or given) target immediately. */
  snap(length?: number): void {
    if (this.destroyed) return;
    if (length !== undefined) this.pacer.setTarget(length, { done: true });
    this.stop();
    this.pacer.snap();
    this.emit();
  }

  /** Cancel a pending frame without changing the revealed length. */
  stop(): void {
    if (this.frame !== undefined) this.frames?.cancel(this.frame);
    this.frame = undefined;
    this.lastTimestamp = undefined;
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
  }

  private schedule(): void {
    if (this.frame !== undefined || !this.frames) return;
    this.frame = this.frames.request((timestamp) => this.step(timestamp));
  }

  private step(timestamp: number): void {
    this.frame = undefined;
    if (this.destroyed) return;
    const dt =
      this.lastTimestamp === undefined
        ? FALLBACK_FRAME_MS
        : timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    this.pacer.advance(dt);
    this.emit();
    if (!this.pacer.settled) {
      this.schedule();
      return;
    }
    this.lastTimestamp = undefined;
    this.options.onSettled?.();
  }

  private emit(): void {
    const shown = this.pacer.shownLength;
    if (shown === this.emitted) return;
    this.emitted = shown;
    this.options.onReveal(shown);
  }
}
