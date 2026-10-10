/** Latest-value trailing throttle; cancellation prevents stale splash updates. */
export class StartupProgressThrottle<T> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private latest: T | undefined;
  private lastUpdateAt = -Infinity;

  constructor(
    private readonly now: () => number,
    private readonly apply: (value: T) => void,
  ) {}

  report(value: T): void {
    this.latest = value;
    if (this.timer) return;
    const flush = () => {
      this.timer = undefined;
      if (this.latest === undefined) return;
      this.lastUpdateAt = this.now();
      this.apply(this.latest);
    };
    const wait = Math.max(0, 250 - (this.now() - this.lastUpdateAt));
    if (wait === 0) flush();
    else this.timer = setTimeout(flush, wait);
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.latest = undefined;
  }
}
