import type { ProtocolClock, ProtocolTimers } from "../runtime/ports.js";

export class ServerHeartbeat {
  #interval?: unknown;
  #watchdog?: unknown;
  #lastReceivedAt = 0;

  constructor(
    private readonly options: {
      clock: ProtocolClock;
      timers: ProtocolTimers;
      intervalMs: number;
      timeoutMs: number;
      isReady: () => boolean;
      send: () => void | Promise<void>;
      timeout: () => void | Promise<void>;
      onError: (error: unknown) => void;
    },
  ) {}

  received(): void {
    this.#lastReceivedAt = this.options.clock.now();
  }

  start(): void {
    this.stop();
    this.received();
    this.#interval = this.options.timers.setInterval(() => {
      if (this.options.isReady()) this.#invoke(this.options.send);
    }, this.options.intervalMs);
    this.#watchdog = this.options.timers.setInterval(
      () => {
        if (
          this.options.isReady() &&
          this.options.clock.now() - this.#lastReceivedAt >
            this.options.timeoutMs
        )
          this.#invoke(this.options.timeout);
      },
      Math.min(this.options.intervalMs, this.options.timeoutMs),
    );
  }

  #invoke(callback: () => void | Promise<void>): void {
    void Promise.resolve()
      .then(callback)
      .catch((error: unknown) => {
        this.stop();
        this.options.onError(error);
      });
  }

  stop(): void {
    if (this.#interval !== undefined)
      this.options.timers.clearInterval(this.#interval);
    if (this.#watchdog !== undefined)
      this.options.timers.clearInterval(this.#watchdog);
    this.#interval = undefined;
    this.#watchdog = undefined;
  }
}
