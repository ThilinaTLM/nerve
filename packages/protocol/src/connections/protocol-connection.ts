import type {
  ProtocolLimits,
  ProtocolV1Message,
} from "@nervekit/contracts/wire";
import { ProtocolCodec, ProtocolDecodeError } from "../transports/codec.js";
import type { TransportConnection } from "../transports/transport.js";

export interface ProtocolReceiveContext {
  readonly generation: number;
  readonly signal: AbortSignal;
}

/** Injectable timers so waits and watchdogs are deterministic in tests. */
export interface ProtocolConnectionTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: ProtocolConnectionTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;
export const DEFAULT_SLOW_HANDLER_MS = 30_000;

export interface ProtocolConnectionOptions {
  readonly timers?: ProtocolConnectionTimers;
  /** Upper bound for drain()/close() waiting on the receive queue. */
  readonly drainTimeoutMs?: number;
  /** A handler running longer than this is reported once through onError. */
  readonly slowHandlerMs?: number;
  readonly transport: TransportConnection;
  readonly codec?: ProtocolCodec;
  readonly limits?: Pick<ProtocolLimits, "maxMessageBytes">;
  readonly onMessage: (
    message: ProtocolV1Message,
    context: ProtocolReceiveContext,
  ) => void | Promise<void>;
  readonly onProtocolError?: (
    error: ProtocolDecodeError,
  ) => void | Promise<void>;
  readonly onError?: (error: unknown) => void | Promise<void>;
}

export class ProtocolConnection {
  readonly #transport: TransportConnection;
  readonly #codec: ProtocolCodec;
  readonly #dispose: Array<() => void>;
  readonly #abort = new AbortController();
  readonly #timers: ProtocolConnectionTimers;
  #receiveTail: Promise<void> = Promise.resolve();
  #generation = 0;
  #disposed = false;

  constructor(private readonly options: ProtocolConnectionOptions) {
    this.#transport = options.transport;
    this.#timers = options.timers ?? defaultTimers;
    this.#codec = options.codec ?? new ProtocolCodec(options.limits);
    this.#dispose = [
      this.#transport.onMessage((frame) => this.#enqueue(frame)),
      this.#transport.onError((error) => this.#reportError(error)),
    ];
  }

  setLimits(limits: Pick<ProtocolLimits, "maxMessageBytes">): void {
    this.#codec.setMaxMessageBytes(limits.maxMessageBytes);
  }

  send(message: ProtocolV1Message): void | Promise<void> {
    return this.#transport.send(this.#codec.encode(message));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#abort.abort();
    this.#generation += 1;
    for (const dispose of this.#dispose.splice(0)) dispose();
  }

  /** Waits for queued frames, giving up (and reporting) after the timeout. */
  async drain(options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs =
      options.timeoutMs ??
      this.options.drainTimeoutMs ??
      DEFAULT_DRAIN_TIMEOUT_MS;
    let handle: unknown;
    const timedOut = new Promise<true>((resolve) => {
      handle = this.#timers.setTimeout(() => resolve(true), timeoutMs);
    });
    try {
      const result = await Promise.race([
        this.#receiveTail.then(() => false as const),
        timedOut,
      ]);
      if (result)
        this.#notify(
          new Error(
            `Protocol receive queue drain timed out after ${timeoutMs}ms`,
          ),
        );
    } finally {
      this.#timers.clearTimeout(handle);
    }
  }

  async close(code?: number, reason?: string): Promise<void> {
    this.dispose();
    await this.#transport.close(code, reason);
    await this.drain();
  }

  #enqueue(frame: string): void {
    const generation = this.#generation;
    this.#receiveTail = this.#receiveTail
      .then(async () => {
        if (this.#disposed || generation !== this.#generation) return;
        await this.receive(frame, generation);
      })
      .catch((error: unknown) => this.#reportError(error, generation));
  }

  #reportError(error: unknown, generation = this.#generation): void {
    if (this.#disposed || generation !== this.#generation) return;
    this.#notify(error);
  }

  /** Reports regardless of disposal (used for close-time diagnostics). */
  #notify(error: unknown): void {
    Promise.resolve()
      .then(() => this.options.onError?.(error))
      .catch((handlerError: unknown) => {
        console.error("Protocol onError handler failed", handlerError);
      });
  }

  private async receive(frame: string, generation: number): Promise<void> {
    if (this.#disposed || generation !== this.#generation) return;
    try {
      const message = this.#codec.decode(frame);
      if (this.#disposed || generation !== this.#generation) return;
      const slowMs = this.options.slowHandlerMs ?? DEFAULT_SLOW_HANDLER_MS;
      const watchdog = this.#timers.setTimeout(() => {
        this.#reportError(
          new Error(
            `Protocol handler for "${message.kind}" exceeded ${slowMs}ms`,
          ),
          generation,
        );
      }, slowMs);
      try {
        await this.options.onMessage(message, {
          generation,
          signal: this.#abort.signal,
        });
      } finally {
        this.#timers.clearTimeout(watchdog);
      }
    } catch (error) {
      if (this.#disposed || generation !== this.#generation) return;
      if (error instanceof ProtocolDecodeError) {
        try {
          await this.options.onProtocolError?.(error);
        } catch (callbackError) {
          this.#reportError(callbackError, generation);
        }
        return;
      }
      this.#reportError(error, generation);
    }
  }
}
