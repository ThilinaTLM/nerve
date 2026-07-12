import { randomUUID } from "node:crypto";
import {
  allOperationDefinitions,
  type EventEnvelope,
  type ProtocolV1Message,
  type StreamState,
} from "@nervekit/contracts";
import {
  createMessageFactory,
  ProtocolConnection,
  ProtocolServerSession,
  websocketTransport,
  type ReplaySource,
  type WebSocketLike,
} from "@nervekit/protocol";
import type { WebSocket } from "ws";
import type { ManagerState } from "../app/manager-state.js";
import {
  MANAGER_EVENT_STORE_ID,
  MANAGER_EVENT_STREAM,
} from "../events/manager-events.js";
import { managerWebSocketRpcDispatcher } from "./manager-protocol-http-dispatcher.js";
import type { SandboxWsServer } from "./sandbox-ws-server.js";

const RPC_CAPABILITIES = allOperationDefinitions()
  .filter(
    (definition) =>
      definition.allowedTargetRoles.includes("sandbox_manager") ||
      definition.allowedTargetRoles.includes("sandbox_agent"),
  )
  .map((definition) => definition.requiredCapability)
  .filter((capability): capability is string => Boolean(capability));

const CAPABILITIES = [
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "sandbox.manager.ui.v1",
  "sandbox.manager.snapshots.v1",
  "operation.sandbox.manager.recovery.get",
  "sandbox.manager.lifecycle.v1",
  ...RPC_CAPABILITIES,
];
const LIMITS = {
  maxMessageBytes: 1_000_000,
  maxBatchEvents: 1_000,
  maxBatchBytes: 1_000_000,
  maxInflightBatches: 16,
  maxUnackedDurableEvents: 10_000,
};

export async function createManagerUiSharedSession(
  ws: WebSocket,
  state: ManagerState,
  server: SandboxWsServer,
): Promise<void> {
  const streamStates = new Map<string, StreamState>();
  const activeStreams = new Set<string>([MANAGER_EVENT_STREAM]);
  const records = await state.sandboxes.list();
  const streams = [
    [MANAGER_EVENT_STREAM, MANAGER_EVENT_STORE_ID] as const,
    ...records.map(
      (record) => [`sandbox:${record.sandboxId}`, record.sandboxId] as const,
    ),
  ];
  for (const [stream, storeId] of streams)
    streamStates.set(stream, await loadStreamState(state, stream, storeId));

  const peer = {
    role: "sandbox_manager" as const,
    id: "sandbox-manager",
    instanceId: "sandbox-manager",
  };
  const messages = createMessageFactory({
    source: peer,
    target: { role: "ui" },
  });
  const transport = websocketTransport(ws as unknown as WebSocketLike);
  let disposed = false;
  let unsubscribe: () => void = () => undefined;
  const replaySource = managerReplaySource(state, streamStates, activeStreams);
  const session: ProtocolServerSession = new ProtocolServerSession({
    acceptingPeer: peer,
    allowedPeerRoles: ["ui"],
    createMessage: messages,
    capabilities: CAPABILITIES,
    streams: () =>
      [...activeStreams].flatMap((stream) => {
        const current = streamStates.get(stream);
        return current ? [current] : [];
      }),
    limits: LIMITS,
    heartbeat: {
      intervalMs: 15_000,
      timeoutMs: state.config.heartbeatTimeoutMs,
    },
    sessionId: () => `ses_${randomUUID()}`,
    send: async (message): Promise<void> => {
      await connection.send(message as ProtocolV1Message);
    },
    authorizeTarget: async (message, context) => {
      const target = message.target;
      if (
        target.role === context.negotiatedTarget.role &&
        target.id === context.negotiatedTarget.id &&
        target.instanceId === context.negotiatedTarget.instanceId &&
        target.name === context.negotiatedTarget.name
      )
        return true;
      if (
        target.role !== "sandbox_agent" ||
        !target.id ||
        target.instanceId !== undefined ||
        target.name !== undefined
      )
        return false;
      return Boolean(await state.sandboxes.get(target.id));
    },
    rpcDispatcher: ({ capabilities }) =>
      managerWebSocketRpcDispatcher(state, server, capabilities),
    replaySource,
    resume: async (hello) => {
      const requested = hello.resume?.streams ?? [];
      const names = requested.map((cursor) => cursor.stream);
      if (new Set(names).size !== names.length)
        return { accepted: false, mode: "snapshot_required" as const };
      const sandboxStreams = names.filter((stream) =>
        stream.startsWith("sandbox:"),
      );
      if (
        names.some(
          (stream) =>
            stream !== MANAGER_EVENT_STREAM && !stream.startsWith("sandbox:"),
        ) ||
        sandboxStreams.length > 1 ||
        names.some((stream) => !streamStates.has(stream))
      )
        return { accepted: false, mode: "snapshot_required" as const };
      activeStreams.clear();
      activeStreams.add(MANAGER_EVENT_STREAM);
      for (const stream of sandboxStreams) activeStreams.add(stream);
      let needsReplay = false;
      for (const cursor of requested) {
        const current = streamStates.get(cursor.stream);
        if (!current || cursor.processedSeq > (current.durableSeq ?? 0))
          return { accepted: false, mode: "snapshot_required" as const };
        if (
          cursor.processedSeq > 0 &&
          cursor.processedSeq < (current.replayAvailableFromSeq ?? 0)
        )
          return { accepted: false, mode: "snapshot_required" as const };
        if (cursor.processedSeq < (current.durableSeq ?? 0)) needsReplay = true;
      }
      return {
        accepted: true,
        mode: needsReplay ? ("replay" as const) : ("live" as const),
      };
    },
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    session.dispose();
    connection.dispose();
  };
  const protocolFailure = async () => {
    try {
      await session.shutdown("protocol_error", "Invalid protocol frame");
      await transport.close(1002, "protocol_error");
    } finally {
      dispose();
    }
  };
  const connection: ProtocolConnection = new ProtocolConnection({
    transport,
    onMessage: (message): Promise<void> => session.receive(message),
    onProtocolError: () => void protocolFailure(),
    onError: (error) => {
      state.logger.warn("Manager UI protocol session failed", {
        error: boundedError(error),
      });
      dispose();
    },
  });
  unsubscribe = state.eventBus.subscribe((event) => {
    const stream = event.stream ?? MANAGER_EVENT_STREAM;
    const current = streamStates.get(stream);
    if (current && typeof event.seq === "number") {
      streamStates.set(stream, {
        ...current,
        latestSeq: Math.max(current.latestSeq, event.seq),
        durableSeq:
          event.durability === "transient"
            ? current.durableSeq
            : Math.max(current.durableSeq ?? 0, event.seq),
      });
    }
    if (!activeStreams.has(stream)) return;
    const envelope = toEnvelope(event);
    void session.publish(stream, envelope).catch((error: unknown) => {
      state.logger.warn("Manager UI event publication failed", {
        error: boundedError(error),
      });
      dispose();
    });
  });
  ws.once("close", dispose);
  ws.once("error", dispose);
}

function managerReplaySource(
  state: ManagerState,
  streamStates: Map<string, StreamState>,
  activeStreams: ReadonlySet<string>,
): ReplaySource {
  return {
    streams: () => [...streamStates.values()],
    async read(request) {
      const storeId = storeIdForStream(request.stream);
      const current = activeStreams.has(request.stream)
        ? streamStates.get(request.stream)
        : undefined;
      if (!storeId || !current)
        return {
          available: false,
          reason: "stream_not_found" as const,
          latestSeq: 0,
        };
      if (request.fromSeq > (current.durableSeq ?? 0) + 1)
        return {
          available: false,
          reason: "cursor_ahead_of_server" as const,
          latestSeq: current.durableSeq ?? 0,
          recovery: { action: "load_snapshot" as const },
        };
      if (
        request.fromSeq > 1 &&
        request.fromSeq - 1 < (current.replayAvailableFromSeq ?? 0)
      )
        return {
          available: false,
          reason: "cursor_too_old" as const,
          earliestAvailableSeq: current.replayAvailableFromSeq,
          latestSeq: current.durableSeq ?? 0,
          recovery: { action: "load_snapshot" as const },
        };
      const all = (await state.events.list(storeId))
        .filter((event) => event.durability !== "transient")
        .map(toStoredEnvelope)
        .filter(
          (event) =>
            event.seq >= request.fromSeq &&
            event.seq <= (request.toSeq ?? Number.MAX_SAFE_INTEGER),
        );
      const events = all.slice(0, request.limit);
      return {
        available: true,
        events,
        previousDurableSeq: Math.max(
          0,
          ...(await state.events.list(storeId))
            .filter(
              (event) =>
                event.durability !== "transient" &&
                (event.seq ?? 0) < request.fromSeq,
            )
            .map((event) => event.seq ?? 0),
        ),
        complete: events.length === all.length,
        nextSeq: (events.at(-1)?.seq ?? request.fromSeq - 1) + 1,
      };
    },
  };
}

async function loadStreamState(
  state: ManagerState,
  stream: string,
  storeId: string,
): Promise<StreamState> {
  const events = await state.events.list(storeId);
  const latestSeq = Math.max(0, ...events.map((event) => event.seq ?? 0));
  const durable = events.filter((event) => event.durability !== "transient");
  const durableSeq = Math.max(0, ...durable.map((event) => event.seq ?? 0));
  const first = Math.min(
    ...durable.map((event) => event.seq ?? Number.POSITIVE_INFINITY),
  );
  return {
    stream,
    latestSeq,
    durableSeq,
    replayAvailableFromSeq: Number.isFinite(first) ? Math.max(0, first - 1) : 0,
  };
}

function storeIdForStream(stream: string): string | undefined {
  if (stream === MANAGER_EVENT_STREAM) return MANAGER_EVENT_STORE_ID;
  return stream.startsWith("sandbox:")
    ? stream.slice("sandbox:".length)
    : undefined;
}

function toStoredEnvelope(
  event: Awaited<ReturnType<ManagerState["events"]["list"]>>[number],
): EventEnvelope<Record<string, unknown>> {
  return {
    id: event.id ?? `evt_${event.sandboxId}_${event.seq ?? 0}`,
    seq: event.seq ?? 0,
    type: event.type,
    ts: event.ts ?? new Date(0).toISOString(),
    durability: event.durability ?? "durable",
    data: isRecord(event.payload) ? event.payload : { value: event.payload },
  };
}

function toEnvelope(
  event: Parameters<ManagerState["eventBus"]["publish"]>[0],
): EventEnvelope<Record<string, unknown>> {
  return {
    id: event.id ?? `evt_${randomUUID()}`,
    seq: event.seq ?? 0,
    type: event.type,
    ts: event.ts ?? new Date().toISOString(),
    durability: event.durability ?? "durable",
    data: isRecord(event.payload) ? event.payload : { value: event.payload },
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
