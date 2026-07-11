import type {
  TransportClose,
  TransportConnection,
  TransportFactory,
  TransportState,
} from "./transport.js";

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (
    type: string,
    listener: (event: unknown) => void,
  ) => void;
  on?: (type: string, listener: (...args: unknown[]) => void) => void;
  off?: (type: string, listener: (...args: unknown[]) => void) => void;
}

export function websocketTransport(socket: WebSocketLike): TransportConnection {
  return {
    get state(): TransportState {
      return socketState(socket.readyState);
    },
    send(frame) {
      if (socket.readyState !== 1) throw new Error("WebSocket is not open");
      socket.send(frame);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    onMessage(listener) {
      return subscribe(socket, "message", (...args) => {
        const event = args[0] as { data?: unknown } | string | Uint8Array;
        const data =
          event && typeof event === "object" && "data" in event
            ? event.data
            : event;
        listener(frameText(data));
      });
    },
    onClose(listener) {
      return subscribe(socket, "close", (...args) => {
        const event = args[0] as
          | { code?: number; reason?: string; wasClean?: boolean }
          | number;
        const close: TransportClose =
          typeof event === "number"
            ? {
                code: event,
                reason:
                  typeof args[1] === "string" ? args[1] : frameText(args[1]),
              }
            : {
                code: event?.code,
                reason: event?.reason,
                clean: event?.wasClean,
              };
        listener(close);
      });
    },
    onError(listener) {
      return subscribe(socket, "error", (...args) => listener(args[0]));
    },
  };
}

export function browserWebSocketTransportFactory(
  url: string | URL,
  protocols?: string | string[],
): TransportFactory {
  return {
    async connect(signal) {
      const socket = new WebSocket(url, protocols);
      await waitForOpen(socket, signal);
      return websocketTransport(socket);
    },
  };
}

/** Node `ws` binding without taking a runtime dependency on `ws`. */
export function nodeWebSocketTransportFactory(
  connectSocket: () => WebSocketLike | Promise<WebSocketLike>,
): TransportFactory {
  return {
    async connect(signal) {
      if (signal?.aborted) throw signal.reason;
      const socket = await connectSocket();
      if (socket.readyState !== 1) await waitForOpen(socket, signal);
      return websocketTransport(socket);
    },
  };
}

function waitForOpen(
  socket: WebSocketLike,
  signal?: AbortSignal,
): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const offOpen = subscribe(socket, "open", () => {
      cleanup();
      resolve();
    });
    const offError = subscribe(socket, "error", (...args) => {
      cleanup();
      reject(args[0] ?? new Error("WebSocket connection failed"));
    });
    const abort = () => {
      cleanup();
      socket.close(1000, "aborted");
      reject(signal?.reason ?? new Error("WebSocket connection aborted"));
    };
    const cleanup = () => {
      offOpen();
      offError();
      signal?.removeEventListener("abort", abort);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function subscribe(
  socket: WebSocketLike,
  type: string,
  listener: (...args: unknown[]) => void,
): () => void {
  if (socket.addEventListener && socket.removeEventListener) {
    const browserListener = listener as (event: unknown) => void;
    socket.addEventListener(type, browserListener);
    return () => socket.removeEventListener?.(type, browserListener);
  }
  if (socket.on) {
    socket.on(type, listener);
    return () => socket.off?.(type, listener);
  }
  throw new Error("Unsupported WebSocket implementation");
}

function frameText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer)
    return new TextDecoder().decode(new Uint8Array(value));
  if (ArrayBuffer.isView(value))
    return new TextDecoder().decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  return String(value ?? "");
}

function socketState(readyState: number): TransportState {
  if (readyState === 0) return "connecting";
  if (readyState === 1) return "open";
  if (readyState === 2) return "closing";
  return "closed";
}
