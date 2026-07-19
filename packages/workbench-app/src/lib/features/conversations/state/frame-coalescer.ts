type DefaultFrameHandle = {
  cancelled: boolean;
  animationFrame?: number;
};

export type FrameScheduler<Handle = DefaultFrameHandle> = (
  callback: () => void,
) => Handle;
export type FrameCanceller<Handle = DefaultFrameHandle> = (
  handle: Handle,
) => void;

function defaultSchedule(callback: () => void): DefaultFrameHandle {
  const handle: DefaultFrameHandle = { cancelled: false };
  const run = () => {
    if (!handle.cancelled) callback();
  };
  if (typeof requestAnimationFrame === "function") {
    handle.animationFrame = requestAnimationFrame(run);
  } else {
    queueMicrotask(run);
  }
  return handle;
}

function defaultCancel(handle: DefaultFrameHandle): void {
  handle.cancelled = true;
  if (
    handle.animationFrame !== undefined &&
    typeof cancelAnimationFrame === "function"
  ) {
    cancelAnimationFrame(handle.animationFrame);
  }
}

/**
 * Coalesces rapidly changing presentation values into one latest-value commit
 * per animation frame. Canonical state remains owned by the caller; this class
 * only schedules its visual projection.
 */
export class FrameCoalescer<T, Handle = DefaultFrameHandle> {
  private pending: T | undefined;
  private hasPending = false;
  private frame: Handle | undefined;
  private destroyed = false;

  constructor(
    private readonly commit: (value: T) => void,
    private readonly schedule: FrameScheduler<Handle> = defaultSchedule as FrameScheduler<Handle>,
    private readonly cancel: FrameCanceller<Handle> = defaultCancel as FrameCanceller<Handle>,
  ) {}

  enqueue(value: T): void {
    if (this.destroyed) return;
    this.pending = value;
    this.hasPending = true;
    if (this.frame !== undefined) return;
    this.frame = this.schedule(() => this.flushPending());
  }

  /** Retain the latest value without scheduling work for a hidden consumer. */
  hold(value: T): void {
    if (this.destroyed) return;
    this.pending = value;
    this.hasPending = true;
    this.cancelFrame();
  }

  flushNow(value?: T): void {
    if (this.destroyed) return;
    if (arguments.length > 0) {
      this.pending = value as T;
      this.hasPending = true;
    }
    this.cancelFrame();
    this.flushPending();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelFrame();
    this.pending = undefined;
    this.hasPending = false;
  }

  private cancelFrame(): void {
    if (this.frame === undefined) return;
    this.cancel(this.frame);
    this.frame = undefined;
  }

  private flushPending(): void {
    this.frame = undefined;
    if (this.destroyed || !this.hasPending) return;
    const value = this.pending as T;
    this.pending = undefined;
    this.hasPending = false;
    this.commit(value);
  }
}
