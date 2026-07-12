import type { ProtocolV1Message } from "@nervekit/contracts";
import {
  ProtocolCodec,
  type ProtocolClock,
  type ProtocolTimers,
  type TransportClose,
  type TransportConnection,
  type TransportState,
} from "../src/index.js";

const codec = new ProtocolCodec();

export class ManualTransport implements TransportConnection {
  state: TransportState = "open";
  constructor(private readonly failSend = false) {}
  readonly messages: string[] = [];
  readonly #messageListeners = new Set<(frame: string) => void>();
  readonly #closeListeners = new Set<(close: TransportClose) => void>();
  readonly #errorListeners = new Set<(error: unknown) => void>();

  send(frame: string): void {
    if (this.state !== "open") throw new Error("transport closed");
    if (this.failSend) throw new Error("initial send failed");
    this.messages.push(frame);
  }

  close(code = 1000, reason = ""): void {
    if (this.state === "closed") return;
    this.state = "closed";
    for (const listener of this.#closeListeners)
      listener({ code, reason, clean: code === 1000 });
  }

  async emit(message: ProtocolV1Message): Promise<void> {
    for (const listener of this.#messageListeners)
      listener(codec.encode(message));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  remoteClose(code: number, reason: string): void {
    this.close(code, reason);
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

export class ManualRuntime implements ProtocolClock, ProtocolTimers {
  #now = 0;
  #nextId = 1;
  readonly #entries = new Map<
    number,
    { callback: () => void; at: number; interval?: number }
  >();

  now(): number {
    return this.#now;
  }

  isoNow(): string {
    return new Date(this.#now).toISOString();
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    return this.#add(callback, delayMs);
  }

  clearTimeout(handle: unknown): void {
    this.#entries.delete(handle as number);
  }

  setInterval(callback: () => void, intervalMs: number): unknown {
    return this.#add(callback, intervalMs, intervalMs);
  }

  clearInterval(handle: unknown): void {
    this.#entries.delete(handle as number);
  }

  advance(milliseconds: number): void {
    const target = this.#now + milliseconds;
    while (true) {
      const due = [...this.#entries.entries()]
        .filter(([, entry]) => entry.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      const [id, entry] = due;
      this.#now = entry.at;
      if (entry.interval === undefined) this.#entries.delete(id);
      else entry.at += entry.interval;
      entry.callback();
    }
    this.#now = target;
  }

  #add(callback: () => void, delayMs: number, interval?: number): number {
    const id = this.#nextId++;
    this.#entries.set(id, {
      callback,
      at: this.#now + delayMs,
      interval,
    });
    return id;
  }
}
