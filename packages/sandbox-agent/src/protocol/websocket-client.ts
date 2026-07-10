import type { NerveMessage, ProtocolV1Message } from "@nervekit/contracts";
import { ProtocolCodec } from "@nervekit/protocol";
import WebSocket from "ws";

export type SandboxWebSocketClientOptions = {
  headers?: Record<string, string>;
  connectTimeoutMs?: number;
};

export class SandboxWebSocketClient extends EventTarget {
  private socket?: WebSocket;
  private readonly queue: NerveMessage[] = [];
  private readonly codec = new ProtocolCodec();
  private closedByClient = false;
  readonly headers: Record<string, string>;
  readonly connectTimeoutMs: number;

  constructor(
    private readonly url: string,
    optionsOrHeaders:
      | SandboxWebSocketClientOptions
      | Record<string, string> = {},
  ) {
    super();
    if (isClientOptions(optionsOrHeaders)) {
      this.headers = optionsOrHeaders.headers ?? {};
      this.connectTimeoutMs = optionsOrHeaders.connectTimeoutMs ?? 10_000;
    } else {
      this.headers = optionsOrHeaders;
      this.connectTimeoutMs = 10_000;
    }
  }

  connect(): void {
    this.closedByClient = false;
    const socket = new WebSocket(this.url, { headers: this.headers });
    this.socket = socket;
    const timeout = setTimeout(() => {
      socket.close(1000, "connect_timeout");
      this.dispatchEvent(
        new CustomEvent("error", { detail: new Error("connect_timeout") }),
      );
    }, this.connectTimeoutMs);
    socket.on("open", () => {
      clearTimeout(timeout);
      this.dispatchEvent(new Event("open"));
      while (this.queue.length && socket.readyState === WebSocket.OPEN) {
        socket.send(this.codec.encode(this.queue.shift() as ProtocolV1Message));
      }
    });
    socket.on("message", (data) => {
      try {
        this.dispatchEvent(
          new CustomEvent("message", {
            detail: this.codec.decode(String(data)),
          }),
        );
      } catch (error) {
        this.dispatchEvent(new CustomEvent("error", { detail: error }));
      }
    });
    socket.on("close", (code, reason) => {
      clearTimeout(timeout);
      this.dispatchEvent(
        new CustomEvent("close", {
          detail: {
            code,
            reason: reason.toString(),
            closedByClient: this.closedByClient,
          },
        }),
      );
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
    });
  }

  send(message: NerveMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(this.codec.encode(message as ProtocolV1Message));
      return;
    }
    this.queue.push(message);
  }

  close(): void {
    this.closedByClient = true;
    this.socket?.close();
  }
}

function isClientOptions(
  value: SandboxWebSocketClientOptions | Record<string, string>,
): value is SandboxWebSocketClientOptions {
  return (
    Object.hasOwn(value, "headers") || Object.hasOwn(value, "connectTimeoutMs")
  );
}
