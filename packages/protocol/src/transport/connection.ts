import type { ProtocolV1Message } from "@nervekit/contracts";
import { ProtocolCodec, ProtocolDecodeError } from "./codec.js";
import type { TransportConnection } from "./transport.js";

export interface ProtocolReceiveContext {
  readonly generation: number;
  readonly signal: AbortSignal;
}

export interface ProtocolConnectionOptions {
  readonly transport: TransportConnection;
  readonly codec?: ProtocolCodec;
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
  #receiveTail: Promise<void> = Promise.resolve();
  #generation = 0;
  #disposed = false;

  constructor(private readonly options: ProtocolConnectionOptions) {
    this.#transport = options.transport;
    this.#codec = options.codec ?? new ProtocolCodec();
    this.#dispose = [
      this.#transport.onMessage((frame) => this.#enqueue(frame)),
      this.#transport.onError((error) => this.#reportError(error)),
    ];
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

  async drain(): Promise<void> {
    await this.#receiveTail;
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
    Promise.resolve(this.options.onError?.(error)).catch(() => undefined);
  }

  private async receive(frame: string, generation: number): Promise<void> {
    if (this.#disposed || generation !== this.#generation) return;
    try {
      const message = this.#codec.decode(frame);
      if (this.#disposed || generation !== this.#generation) return;
      await this.options.onMessage(message, {
        generation,
        signal: this.#abort.signal,
      });
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
