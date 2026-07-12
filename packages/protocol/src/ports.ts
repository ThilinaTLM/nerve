import type {
  EventEnvelope,
  PeerDescriptor,
  ProtocolErrorData,
  StreamCursor,
  StreamState,
} from "@nervekit/contracts";
import type { TransportFactory } from "./transport.js";

export interface ReplayReadRequest {
  readonly stream: string;
  readonly fromSeq: number;
  readonly toSeq?: number;
  readonly limit: number;
}

export interface ReplayReadResult {
  readonly events: readonly EventEnvelope[];
  /** Durable cursor immediately before the first returned event. */
  readonly previousDurableSeq?: number;
  readonly complete: boolean;
  readonly nextSeq?: number;
}

export interface ReplaySource {
  streams(): readonly StreamState[] | Promise<readonly StreamState[]>;
  read(
    request: ReplayReadRequest,
  ): ReplayReadResult | Promise<ReplayReadResult>;
}

export interface SnapshotRecoveryResult<T = unknown> {
  readonly snapshot: T;
  readonly cursors: readonly StreamCursor[];
  readonly stateEpoch?: string;
}

export interface SnapshotRecovery<T = unknown> {
  load(input: {
    readonly peer: PeerDescriptor;
    readonly reason: "retention_gap" | "ahead_cursor" | "replay_unavailable";
    readonly streams: readonly string[];
  }): SnapshotRecoveryResult<T> | Promise<SnapshotRecoveryResult<T>>;
}

export interface ProcessedEventSink {
  persist(cursors: readonly StreamCursor[]): void | Promise<void>;
}

export interface ProtocolDiagnosticsPublisher {
  publish(diagnostic: {
    readonly type:
      | "queue"
      | "flow"
      | "replay"
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
  create(prefix: "msg" | "ack" | "rpl" | "batch" | "session"): string;
}

export type ProtocolTransportFactory = TransportFactory;
