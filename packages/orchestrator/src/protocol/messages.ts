import {
  createId,
  type NerveMessage,
  type PeerDescriptor,
} from "@nervekit/shared";

export interface ProtocolMessageOptions {
  source?: PeerDescriptor;
  target?: PeerDescriptor;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  replyTo?: string;
  requiresAck?: boolean;
  meta?: Record<string, unknown>;
}

export function createProtocolMessage<TData>(
  kind: string,
  data: TData,
  options: ProtocolMessageOptions = {},
): NerveMessage<TData> {
  return {
    protocol: "nerve",
    version: 1,
    id: createId("msg"),
    kind,
    ts: new Date().toISOString(),
    ...options,
    data,
  };
}

export function orchestratorSource(id: string): PeerDescriptor {
  return {
    role: "orchestrator",
    id,
    name: "Nerve Orchestrator",
  };
}
