import type {
  HelloData,
  NerveMessage,
  OperationName,
  OperationParams,
  OperationResult,
  PeerDescriptor,
  PeerRole,
  ProtocolLimits,
  ProtocolRequestData,
  ProtocolV1Message,
  StreamCursor,
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
  /** Authorizes post-handshake targets; defaults to the target addressed by hello. */
  readonly authorizeTarget?: (
    message: ProtocolV1Message,
    context: {
      readonly peer: PeerDescriptor;
      readonly negotiatedTarget: PeerDescriptor;
      readonly acceptingPeer: PeerDescriptor;
    },
  ) => boolean | Promise<boolean>;
  readonly onReady?: (
    message: ProtocolV1Message & { kind: "ready" },
  ) => void | Promise<void>;
  readonly onMessage?: (message: ProtocolV1Message) => void | Promise<void>;
  /** Applies a peer-owned event batch before the shared session acknowledges it. */
  readonly onEventBatch?: (
    message: ProtocolV1Message & { kind: "event.batch" },
  ) =>
    | {
        readonly streams: readonly StreamCursor[];
        readonly appliedEvents?: number;
      }
    | Promise<{
        readonly streams: readonly StreamCursor[];
        readonly appliedEvents?: number;
      }>;
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
  readonly rpcTimeoutMs?: number;
}

export interface ServerSessionRpc {
  request<M extends OperationName>(
    method: M,
    params: OperationParams<M>,
    options?: Pick<
      ProtocolRequestData,
      "idempotencyKey" | "timeoutMs" | "expect"
    > & {
      readonly correlationId?: string;
      readonly causationId?: string;
      readonly traceId?: string;
    },
  ): Promise<OperationResult<M>>;
}
