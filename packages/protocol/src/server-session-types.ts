import type {
  NerveMessage,
  NotifyEvent,
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
  StreamReader,
} from "./ports.js";
import type { RpcDispatcher } from "./rpc.js";

export type ServerSessionState =
  | "awaiting_hello"
  | "awaiting_ready"
  | "ready"
  | "closing"
  | "closed";

export interface StreamSubscriptionDecision {
  readonly accepted: boolean;
  /** Authorized log bounds for the requested exact stream set. */
  readonly streams: readonly StreamState[];
  readonly reason?: string;
}

export interface ServerStreamSubscriptionPort {
  resolve(
    cursors: readonly StreamCursor[],
    peer: PeerDescriptor,
  ): StreamSubscriptionDecision | Promise<StreamSubscriptionDecision>;
  activate?(
    cursors: readonly StreamCursor[],
    states: readonly StreamState[],
  ): void | Promise<void>;
}

export interface ServerSessionOptions {
  readonly acceptingPeer: PeerDescriptor;
  readonly allowedPeerRoles?: readonly PeerRole[];
  readonly createMessage: MessageFactory;
  readonly capabilities?: readonly string[];
  readonly limits: ProtocolLimits;
  readonly heartbeat: {
    readonly intervalMs: number;
    readonly timeoutMs: number;
  };
  readonly sessionId: () => string;
  readonly send: (message: NerveMessage) => void | Promise<void>;
  readonly close?: (code: number, reason: string) => void | Promise<void>;
  readonly maxBufferedEvents?: number;
  readonly maxBufferedBytes?: number;
  readonly notifyQueueLimit?: number;
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
  readonly onEventBatch?: (
    message: ProtocolV1Message & { kind: "event.batch" },
  ) => unknown | Promise<unknown>;
  readonly onNotify?: (
    events: readonly NotifyEvent[],
    message: ProtocolV1Message & { kind: "event.notify" },
  ) => void | Promise<void>;
  readonly rpcDispatcher?:
    | RpcDispatcher
    | ((context: {
        readonly capabilities: readonly string[];
        readonly peer: PeerDescriptor;
      }) => RpcDispatcher);
  readonly readStream?: StreamReader["readStream"];
  readonly subscriptions?: ServerStreamSubscriptionPort;
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
