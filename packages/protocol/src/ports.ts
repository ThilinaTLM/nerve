import type {
  EventEnvelope,
  ProtocolErrorData,
  StreamState,
} from "@nervekit/contracts";
import type { TransportFactory } from "./transport.js";

export interface StreamReadResult extends StreamState {
  readonly events: readonly EventEnvelope[];
}

/** Durable per-stream log reader used by subscription replay. */
export interface StreamReader {
  readStream(
    stream: string,
    fromSeq: number,
    limit: number,
  ): StreamReadResult | Promise<StreamReadResult>;
}

export interface ProtocolDiagnosticsPublisher {
  publish(diagnostic: {
    readonly type:
      | "queue"
      | "subscription"
      | "notify"
      | "heartbeat"
      | "reconnect"
      | "snapshot";
    readonly stream?: string;
    readonly count?: number;
    readonly bytes?: number;
    readonly code?: ProtocolErrorData["code"];
  }): void | Promise<void>;
}

export interface ProtocolClock {
  now(): number;
  isoNow(): string;
}

export interface ProtocolTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ProtocolIdSource {
  create(prefix: "msg" | "batch" | "session" | "sub"): string;
}

export type ProtocolTransportFactory = TransportFactory;
