import {
  decodeMessage,
  encodeMessage,
  type SandboxProtocolMessage,
} from "./messages.js";

export class SandboxWebSocketClient extends EventTarget {
  private socket?: WebSocket;
  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
  ) {
    super();
  }
  connect(): void {
    this.socket = new WebSocket(this.url, []);
    void this.headers;
    this.socket.addEventListener("message", (event) =>
      this.dispatchEvent(
        new CustomEvent("message", {
          detail: decodeMessage(String(event.data)),
        }),
      ),
    );
    this.socket.addEventListener("open", () =>
      this.dispatchEvent(new Event("open")),
    );
    this.socket.addEventListener("close", () =>
      this.dispatchEvent(new Event("close")),
    );
    this.socket.addEventListener("error", () =>
      this.dispatchEvent(new Event("error")),
    );
  }
  send(message: SandboxProtocolMessage): void {
    this.socket?.send(encodeMessage(message));
  }
  close(): void {
    this.socket?.close();
  }
}
