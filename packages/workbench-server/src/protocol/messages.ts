import type {
  NerveMessage,
  PeerDescriptor,
  SafeMetadata,
} from "@nervekit/contracts";
import { createMessageFactory } from "@nervekit/protocol";

export interface ProtocolMessageOptions {
  source?: PeerDescriptor;
  target?: PeerDescriptor;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  replyTo?: string;
  requiresAck?: boolean;
  meta?: SafeMetadata;
}

export function createProtocolMessage<TData>(
  kind: string,
  data: TData,
  options: ProtocolMessageOptions = {},
): NerveMessage<TData> {
  const source = options.source ?? orchestratorSource("workbench-server");
  const target = options.target ?? { role: "ui" as const };
  return createMessageFactory({ source, target })(kind, data, options);
}

export function orchestratorSource(id: string): PeerDescriptor {
  return {
    role: "workbench_server",
    id,
    name: "Nerve Workbench Server",
  };
}
