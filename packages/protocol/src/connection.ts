import type { ProtocolV1Message } from "@nervekit/contracts";
import { ProtocolCodec, ProtocolDecodeError } from "./codec.js";
import type { TransportConnection } from "./transport.js";

export interface ProtocolConnectionOptions {
  readonly transport: TransportConnection;
  readonly codec?: ProtocolCodec;
  readonly onMessage: (message: ProtocolV1Message) => void | Promise<void>;
  readonly onProtocolError?: (
    error: ProtocolDecodeError,
  ) => void | Promise<void>;
  readonly onError?: (error: unknown) => void | Promise<void>;
}

export class ProtocolConnection {
  readonly #transport: TransportConnection;
  readonly #codec: ProtocolCodec;
  readonly #dispose: Array<() => void>;

  constructor(private readonly options: ProtocolConnectionOptions) {
    this.#transport = options.transport;
    this.#codec = options.codec ?? new ProtocolCodec();
    this.#dispose = [
      this.#transport.onMessage((frame) => void this.receive(frame)),
      this.#transport.onError((error) => void options.onError?.(error)),
    ];
  }

  send(message: ProtocolV1Message): void | Promise<void> {
    return this.#transport.send(this.#codec.encode(message));
  }

  close(code?: number, reason?: string): void | Promise<void> {
    for (const dispose of this.#dispose.splice(0)) dispose();
    return this.#transport.close(code, reason);
  }

  private async receive(frame: string): Promise<void> {
    try {
      await this.options.onMessage(this.#codec.decode(frame));
    } catch (error) {
      if (error instanceof ProtocolDecodeError) {
        await this.options.onProtocolError?.(error);
        return;
      }
      await this.options.onError?.(error);
    }
  }
}
