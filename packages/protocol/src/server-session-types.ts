import type {
  HelloData,
  NerveMessage,
  PeerDescriptor,
  PeerRole,
  ProtocolLimits,
  ProtocolV1Message,
  StreamState,
} from "@nervekit/contracts";
import type { MessageFactory } from "./messages.js";
import type {
  ProtocolClock,
  ProtocolDiagnosticsPublisher,
  ProtocolIdSource,
  ProtocolTimers,
  ReplaySource,
} from "./ports.js";
import type { RpcDispatcher } from "./rpc.js";

export type ServerSessionState =
  | "awaiting_hello"
  | "awaiting_ready"
  | "ready"
  | "closing"
  | "closed";

export interface SessionResumeDecision {
  readonly accepted: boolean;
  readonly mode: "live" | "replay" | "snapshot_required" | "fresh";
  readonly reason?: string;
}

export interface ServerSessionOptions {
  readonly acceptingPeer: PeerDescriptor;
  readonly allowedPeerRoles?: readonly PeerRole[];
  readonly createMessage: MessageFactory;
  readonly capabilities?: readonly string[];
  readonly streams: () => readonly StreamState[];
  readonly limits: ProtocolLimits;
  readonly heartbeat: {
    readonly intervalMs: number;
    readonly timeoutMs: number;
  };
  readonly resume?: (
    hello: HelloData,
    source: PeerDescriptor,
  ) => SessionResumeDecision | Promise<SessionResumeDecision>;
  readonly sessionId: () => string;
  readonly send: (message: NerveMessage) => void | Promise<void>;
  readonly onReady?: (
    message: ProtocolV1Message & { kind: "ready" },
  ) => void | Promise<void>;
  readonly onMessage?: (message: ProtocolV1Message) => void | Promise<void>;
  readonly rpcDispatcher?:
    | RpcDispatcher
    | ((context: {
        readonly capabilities: readonly string[];
        readonly peer: PeerDescriptor;
      }) => RpcDispatcher);
  readonly onAck?: (
    message: ProtocolV1Message & { kind: "event.ack" },
  ) => void | Promise<void>;
  readonly replaySource?: ReplaySource;
  readonly onReplayRequest?: (
    message: ProtocolV1Message & { kind: "replay.request" },
  ) => void | Promise<void>;
  readonly diagnostics?: ProtocolDiagnosticsPublisher;
  readonly clock?: ProtocolClock;
  readonly timers?: ProtocolTimers;
  readonly ids?: ProtocolIdSource;
}
