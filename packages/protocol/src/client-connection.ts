import type {
  NerveMessage,
  OperationName,
  OperationParams,
  OperationResult,
  ProtocolRequestData,
  ProtocolV1Message,
} from "@nervekit/contracts";
import { ProtocolConnection } from "./connection.js";
import type { ProtocolDiagnosticsPublisher, ProtocolTimers } from "./ports.js";
import { ReconnectPolicy } from "./reconnect.js";
import { systemProtocolTimers } from "./runtime.js";
import type { ProtocolClientSession } from "./client-session.js";
import type { TransportConnection, TransportFactory } from "./transport.js";

export type ProtocolClientConnectionState =
  | "idle"
  | "connecting"
  | "handshaking"
  | "ready"
  | "reconnecting"
  | "closing"
  | "closed";

export interface ProtocolClientConnectionOptions {
  readonly transport: TransportFactory;
  readonly createSession: (bindings: {
    readonly send: (message: NerveMessage) => void | Promise<void>;
    readonly onDisconnect: (error: Error) => void;
  }) => ProtocolClientSession;
  readonly reconnect?: ReconnectPolicy;
  readonly timers?: ProtocolTimers;
  readonly handshakeTimeoutMs?: number;
  readonly random?: () => number;
  readonly diagnostics?: ProtocolDiagnosticsPublisher;
  readonly onStateChange?: (state: ProtocolClientConnectionState) => void;
  readonly onError?: (error: unknown) => void | Promise<void>;
}

/** Owns transport generations and reconnect/resume around one client session. */
export class ProtocolClientConnection {
  state: ProtocolClientConnectionState = "idle";
  readonly session: ProtocolClientSession;
  readonly #options: ProtocolClientConnectionOptions;
  readonly #timers: ProtocolTimers;
  readonly #reconnect: ReconnectPolicy;
  #transport?: TransportConnection;
  #connection?: ProtocolConnection;
  #disposeClose?: () => void;
  #reconnectTimer?: unknown;
  #handshakeTimer?: unknown;
  #generation = 0;
  #attempt = 0;
  #stopping = false;

  constructor(options: ProtocolClientConnectionOptions) {
    this.#options = options;
    this.#timers = options.timers ?? systemProtocolTimers;
    this.#reconnect = options.reconnect ?? new ReconnectPolicy();
    this.session = options.createSession({
      send: (message) => this.#send(message),
      onDisconnect: (error) => this.#disconnectTransport(error),
    });
  }

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "closed") return;
    this.#stopping = false;
    this.#attempt = 0;
    await this.#connect(false);
  }

  request<M extends OperationName>(
    method: M,
    params: OperationParams<M>,
    options: Pick<
      ProtocolRequestData,
      "idempotencyKey" | "timeoutMs" | "expect"
    > &
      Partial<
        Pick<
          import("./messages.js").MessageFactoryOptions,
          "correlationId" | "causationId" | "traceId" | "target"
        >
      > = {},
  ): Promise<OperationResult<M>> {
    return this.session.request(method, params, options);
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    this.#stopping = true;
    this.#setState("closing");
    this.#clearTimers();
    try {
      await this.session.close();
    } finally {
      await this.#disposeConnection(1000, "client_closing");
      this.#setState("closed");
    }
  }

  async #connect(reconnecting: boolean): Promise<void> {
    const generation = ++this.#generation;
    this.#setState(reconnecting ? "reconnecting" : "connecting");
    try {
      const transport = await this.#options.transport.connect();
      if (this.#stopping || generation !== this.#generation) {
        await transport.close(1000, "stale_generation");
        return;
      }
      this.#transport = transport;
      this.#disposeClose = transport.onClose((close) => {
        if (generation !== this.#generation) return;
        void this.#handleClose(
          new Error(
            close.reason || `Protocol transport closed (${close.code ?? 0})`,
          ),
        );
      });
      this.#connection = new ProtocolConnection({
        transport,
        onMessage: async (message) => {
          if (generation !== this.#generation) return;
          await this.session.receive(message);
          if (this.session.state === "closed") {
            this.#disconnectTransport(new Error("Protocol session closed"));
            return;
          }
          if (this.session.state === "ready") {
            this.#attempt = 0;
            this.#clearHandshakeTimer();
            this.#setState("ready");
          }
        },
        onProtocolError: async (error) => {
          await this.#options.onError?.(error);
          this.session.disconnect(error);
        },
        onError: async (error) => {
          await this.#options.onError?.(error);
          this.#disconnectTransport(
            error instanceof Error
              ? error
              : new Error("Protocol transport failed"),
          );
        },
      });
      this.#setState("handshaking");
      this.#handshakeTimer = this.#timers.setTimeout(() => {
        if (generation !== this.#generation || this.session.state === "ready")
          return;
        this.session.disconnect(new Error("Protocol handshake timed out"));
      }, this.#options.handshakeTimeoutMs ?? 10_000);
      await this.session.start();
    } catch (error) {
      await this.#options.onError?.(error);
      if (generation === this.#generation) {
        this.session.disconnect(
          error instanceof Error
            ? error
            : new Error("Protocol connection failed"),
        );
        await this.#disposeConnection();
        await this.#scheduleReconnect();
      }
    }
  }

  #send(message: NerveMessage): void | Promise<void> {
    if (!this.#connection) throw new Error("Protocol transport is not open");
    return this.#connection.send(message as ProtocolV1Message);
  }

  #disconnectTransport(error: Error): void {
    void this.#options.onError?.(error);
    void this.#transport?.close(4000, "session_disconnected");
  }

  async #handleClose(error: Error): Promise<void> {
    await this.#disposeConnection();
    this.session.disconnect(error);
    if (this.#stopping) {
      this.#setState("closed");
      return;
    }
    await this.#scheduleReconnect();
  }

  async #scheduleReconnect(): Promise<void> {
    if (this.#stopping || this.#reconnectTimer !== undefined) return;
    const delay = this.#reconnect.delay(
      this.#attempt,
      this.#options.random ?? Math.random,
    );
    if (delay === undefined) {
      this.#setState("closed");
      return;
    }
    this.#attempt += 1;
    this.#setState("reconnecting");
    this.#reconnectTimer = "scheduling";
    try {
      await this.#options.diagnostics?.publish({
        type: "reconnect",
        count: this.#attempt,
      });
      if (this.#stopping) {
        this.#reconnectTimer = undefined;
        return;
      }
      this.#reconnectTimer = this.#timers.setTimeout(() => {
        this.#reconnectTimer = undefined;
        void this.#connect(true);
      }, delay);
    } catch (error) {
      this.#reconnectTimer = undefined;
      await this.#options.onError?.(error);
    }
  }

  async #disposeConnection(code?: number, reason?: string): Promise<void> {
    this.#clearHandshakeTimer();
    this.#disposeClose?.();
    this.#disposeClose = undefined;
    const connection = this.#connection;
    this.#connection = undefined;
    this.#transport = undefined;
    if (connection) await connection.close(code, reason);
  }

  #clearTimers(): void {
    this.#clearHandshakeTimer();
    if (this.#reconnectTimer !== undefined)
      this.#timers.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
  }

  #clearHandshakeTimer(): void {
    if (this.#handshakeTimer !== undefined)
      this.#timers.clearTimeout(this.#handshakeTimer);
    this.#handshakeTimer = undefined;
  }

  #setState(state: ProtocolClientConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.#options.onStateChange?.(state);
  }
}
