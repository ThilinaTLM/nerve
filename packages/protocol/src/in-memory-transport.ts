import type {
  TransportClose,
  TransportConnection,
  TransportState,
} from "./transport.js";

class InMemoryConnection implements TransportConnection {
  state: TransportState = "open";
  peer?: InMemoryConnection;
  readonly #messageListeners = new Set<(frame: string) => void>();
  readonly #closeListeners = new Set<(close: TransportClose) => void>();
  readonly #errorListeners = new Set<(error: unknown) => void>();

  send(frame: string): void {
    if (this.state !== "open" || this.peer?.state !== "open") {
      throw new Error("In-memory transport is closed");
    }
    const peer = this.peer;
    queueMicrotask(() => {
      try {
        if (peer)
          for (const listener of peer.#messageListeners) listener(frame);
      } catch (error) {
        if (peer) for (const listener of peer.#errorListeners) listener(error);
      }
    });
  }

  close(code = 1000, reason = ""): void {
    if (this.state === "closed") return;
    this.state = "closed";
    const peer = this.peer;
    if (peer && peer.state !== "closed") peer.state = "closed";
    const close = { code, reason, clean: code === 1000 };
    queueMicrotask(() => {
      for (const listener of this.#closeListeners) listener(close);
      if (peer) for (const listener of peer.#closeListeners) listener(close);
    });
  }

  onMessage(listener: (frame: string) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onClose(listener: (close: TransportClose) => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  onError(listener: (error: unknown) => void): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }
}

export function createInMemoryTransportPair(): readonly [
  TransportConnection,
  TransportConnection,
] {
  const left = new InMemoryConnection();
  const right = new InMemoryConnection();
  left.peer = right;
  right.peer = left;
  return [left, right];
}
