import { randomUUID } from "node:crypto";
import type {
  NerveMessage,
  PeerDescriptor,
  StreamCursor,
} from "@nervekit/contracts";

const MANAGER_PEER: PeerDescriptor = {
  role: "sandbox_manager",
  id: "sandbox-manager",
  name: "Nerve Sandbox Manager",
};

export type UiProtocolSession = {
  sessionId: string;
  source: PeerDescriptor;
  target: PeerDescriptor;
  subscribedStreams: Set<string>;
  processedDurableCursors: Map<string, number>;
  latestSentSeqs: Map<string, number>;
  heartbeat: {
    connectedAt: string;
    lastReceivedAt: string;
    lastSentAt?: string;
  };
  replay: {
    activeReplayIds: Set<string>;
    recoveredStreams: Set<string>;
  };
};

export function createUiProtocolSession(input: {
  source: PeerDescriptor;
  resume?: { streams?: StreamCursor[] };
}): UiProtocolSession {
  const now = new Date().toISOString();
  const subscribedStreams = new Set<string>(["manager"]);
  const processedDurableCursors = new Map<string, number>();
  for (const cursor of input.resume?.streams ?? []) {
    subscribedStreams.add(cursor.stream);
    processedDurableCursors.set(cursor.stream, cursor.processedSeq);
  }
  if (!processedDurableCursors.has("manager"))
    processedDurableCursors.set("manager", 0);
  return {
    sessionId: `ui_${randomUUID()}`,
    source: MANAGER_PEER,
    target: input.source,
    subscribedStreams,
    processedDurableCursors,
    latestSentSeqs: new Map(),
    heartbeat: { connectedAt: now, lastReceivedAt: now },
    replay: { activeReplayIds: new Set(), recoveredStreams: new Set() },
  };
}

export function updateUiSessionAck(
  session: UiProtocolSession,
  cursors: StreamCursor[],
): void {
  for (const cursor of cursors) {
    const previous = session.processedDurableCursors.get(cursor.stream) ?? 0;
    if (cursor.processedSeq > previous)
      session.processedDurableCursors.set(cursor.stream, cursor.processedSeq);
  }
  session.heartbeat.lastReceivedAt = new Date().toISOString();
}

export function makeManagerMessage<TData>(
  kind: string,
  data: TData,
  options: {
    target?: PeerDescriptor;
    correlationId?: string;
    replyTo?: string;
  } = {},
): NerveMessage<TData> {
  return {
    protocol: "nerve",
    version: 1,
    id: `msg_${randomUUID()}`,
    kind,
    ts: new Date().toISOString(),
    source: MANAGER_PEER,
    target: options.target ?? { role: "ui" },
    correlationId: options.correlationId,
    replyTo: options.replyTo,
    data,
  };
}
