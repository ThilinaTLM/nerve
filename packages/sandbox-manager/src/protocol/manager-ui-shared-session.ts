import { randomUUID } from "node:crypto";
import {
  allOperationDefinitions,
  type EventEnvelope,
  type ProtocolV1Message,
  type StreamCursor,
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
import type { ManagerEvent } from "../events/manager-event-bus.js";
import {
  MANAGER_EVENT_STORE_ID,
  MANAGER_EVENT_STREAM,
} from "../events/manager-events.js";
import type { StoredSandboxEvent } from "../state/event-store.js";
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
  "stream.subscription.v1",
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

/**
 * Return a synchronous WebSocket attachment callback. Stream state is loaded
 * lazily from resume/subscription ports after protocol listeners are attached.
 */
export function prepareManagerUiSharedSession(
  state: ManagerState,
  server: SandboxWsServer,
): (ws: WebSocket) => void {
  return (ws) => attachManagerUiSharedSession(ws, state, server);
}

function attachManagerUiSharedSession(
  ws: WebSocket,
  state: ManagerState,
  server: SandboxWsServer,
): void {
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
  const streamStates = new Map<string, StreamState>();
  const activeStreams = new Set<string>([MANAGER_EVENT_STREAM]);
  const observedHighWater = new Map<
    string,
    { latestSeq: number; durableSeq: number }
  >();
  const pendingSubscriptionStreams = new Set<string>();
  const pendingSubscriptionEvents = new Map<string, ManagerEvent[]>();
  let disposed = false;
  let closing = false;
  let unsubscribe: () => void = () => undefined;
  const binding: { connection?: ProtocolConnection } = {};

  const resolve = async (
    cursors: readonly StreamCursor[],
  ): Promise<
    | { accepted: true; states: StreamState[]; mode: "live" | "replay" }
    | { accepted: false; reason: string }
  > => {
    const policy = await validateRequestedStreams(state, cursors);
    if (!policy.accepted) return policy;
    const states = await Promise.all(
      cursors.map((cursor) =>
        loadStreamState(state, cursor.stream, observedHighWater),
      ),
    );
    for (const stateValue of states)
      streamStates.set(stateValue.stream, stateValue);
    for (const cursor of cursors) {
      const current = streamStates.get(cursor.stream) as StreamState;
      const durableSeq = current.durableSeq ?? current.latestSeq;
      if (cursor.processedSeq > durableSeq)
        return {
          accepted: false,
          reason: `Cursor ahead of ${cursor.stream}`,
        };
      if (
        cursor.processedSeq > 0 &&
        cursor.processedSeq < (current.replayAvailableFromSeq ?? 0)
      )
        return {
          accepted: false,
          reason: `Cursor expired for ${cursor.stream}`,
        };
    }
    return {
      accepted: true,
      states,
      mode: cursors.some(
        (cursor) =>
          cursor.processedSeq <
          (streamStates.get(cursor.stream)?.durableSeq ?? 0),
      )
        ? "replay"
        : "live",
    };
  };

  const replaySource = managerReplaySource(state, streamStates, activeStreams);
  const session = new ProtocolServerSession({
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
      if (!binding.connection)
        throw new Error("Manager UI protocol connection is not attached");
      await binding.connection.send(message as ProtocolV1Message);
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
      const requested = hello.resume?.streams?.length
        ? hello.resume.streams
        : [{ stream: MANAGER_EVENT_STREAM, processedSeq: 0 }];
      const resolved = await resolve(requested);
      if (!resolved.accepted) {
        const manager = await loadStreamState(
          state,
          MANAGER_EVENT_STREAM,
          observedHighWater,
        );
        streamStates.set(MANAGER_EVENT_STREAM, manager);
        activeStreams.clear();
        activeStreams.add(MANAGER_EVENT_STREAM);
        return {
          accepted: false,
          mode: "snapshot_required" as const,
          reason: resolved.reason,
        };
      }
      activeStreams.clear();
      for (const stream of resolved.states) activeStreams.add(stream.stream);
      return {
        accepted: true,
        mode: resolved.mode,
      };
    },
    subscriptions: {
      resolve: async (cursors) => {
        pendingSubscriptionStreams.clear();
        pendingSubscriptionEvents.clear();
        for (const cursor of cursors) {
          if (!activeStreams.has(cursor.stream))
            pendingSubscriptionStreams.add(cursor.stream);
        }
        try {
          const resolved = await resolve(cursors);
          if (!resolved.accepted) {
            pendingSubscriptionStreams.clear();
            pendingSubscriptionEvents.clear();
          }
          return resolved.accepted
            ? { accepted: true, streams: resolved.states }
            : { accepted: false, streams: [], reason: resolved.reason };
        } catch (error) {
          pendingSubscriptionStreams.clear();
          pendingSubscriptionEvents.clear();
          throw error;
        }
      },
      activate: async (_cursors, states) => {
        activeStreams.clear();
        for (const stream of states) activeStreams.add(stream.stream);
        pendingSubscriptionStreams.clear();
        const durableBoundary = new Map(
          states.map((stream) => [
            stream.stream,
            stream.durableSeq ?? stream.latestSeq,
          ]),
        );
        const buffered = [...pendingSubscriptionEvents.values()]
          .flat()
          .filter(
            (event) => event.seq > (durableBoundary.get(event.stream) ?? 0),
          )
          .sort((left, right) => left.seq - right.seq);
        pendingSubscriptionEvents.clear();
        for (const event of buffered)
          await session.publish(event.stream, toEnvelope(event));
        state.logger.debug("Manager UI subscription updated", {
          streams: states.map((stream) => stream.stream),
          bufferedEvents: buffered.length,
        });
      },
    },
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    session.dispose();
    binding.connection?.dispose();
  };
  const closeForFailure = async (
    code: number,
    reason: string,
    error?: unknown,
  ) => {
    if (closing || disposed) return;
    closing = true;
    state.logger.warn("Manager UI protocol transport closing", {
      reason,
      error: error === undefined ? undefined : boundedError(error),
    });
    try {
      await Promise.race([
        session.shutdown("protocol_error", reason),
        new Promise<void>((resolve) => setTimeout(resolve, 100)),
      ]);
    } catch {
      // The transport is closed below even if the bounded goodbye fails.
    }
    try {
      await transport.close(code, reason.slice(0, 123));
    } finally {
      dispose();
    }
  };
  binding.connection = new ProtocolConnection({
    transport,
    onMessage: (message): Promise<void> => session.receive(message),
    onProtocolError: (error) => closeForFailure(1002, "protocol_error", error),
    onError: (error) => closeForFailure(1011, "server_error", error),
  });

  unsubscribe = state.eventBus.subscribe((event) => {
    const observed = observedHighWater.get(event.stream) ?? {
      latestSeq: 0,
      durableSeq: 0,
    };
    observed.latestSeq = Math.max(observed.latestSeq, event.seq);
    if (event.durability === "durable")
      observed.durableSeq = Math.max(observed.durableSeq, event.seq);
    observedHighWater.set(event.stream, observed);
    const current = streamStates.get(event.stream);
    if (current) {
      streamStates.set(event.stream, {
        ...current,
        latestSeq: Math.max(current.latestSeq, event.seq),
        durableSeq:
          event.durability === "transient"
            ? current.durableSeq
            : Math.max(current.durableSeq ?? 0, event.seq),
      });
    }
    if (!activeStreams.has(event.stream)) {
      if (pendingSubscriptionStreams.has(event.stream)) {
        const pending = pendingSubscriptionEvents.get(event.stream) ?? [];
        pending.push(event);
        pendingSubscriptionEvents.set(event.stream, pending);
      }
      return;
    }
    void session
      .publish(event.stream, toEnvelope(event))
      .catch((error: unknown) =>
        closeForFailure(1011, "publication_failed", error),
      );
  });
  ws.once("close", dispose);
  ws.once(
    "error",
    (error) => void closeForFailure(1011, "socket_error", error),
  );
}

function managerReplaySource(
  state: ManagerState,
  streamStates: Map<string, StreamState>,
  activeStreams: ReadonlySet<string>,
): ReplaySource {
  return {
    streams: () =>
      [...activeStreams].flatMap((stream) => {
        const current = streamStates.get(stream);
        return current ? [current] : [];
      }),
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
      const durableSeq = current.durableSeq ?? 0;
      if (request.fromSeq > durableSeq + 1)
        return {
          available: false,
          reason: "cursor_ahead_of_server" as const,
          latestSeq: durableSeq,
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
          latestSeq: durableSeq,
          recovery: { action: "load_snapshot" as const },
        };
      const range = await state.events.readDurableRange(
        storeId,
        request.fromSeq,
        request.toSeq,
        request.limit,
      );
      return {
        available: true,
        events: range.events.map(toStoredEnvelope),
        previousDurableSeq: range.previousDurableSeq,
        complete: range.complete,
        nextSeq: range.nextSeq,
      };
    },
  };
}

async function validateRequestedStreams(
  state: ManagerState,
  cursors: readonly StreamCursor[],
): Promise<{ accepted: true } | { accepted: false; reason: string }> {
  const names = cursors.map((cursor) => cursor.stream);
  if (new Set(names).size !== names.length)
    return { accepted: false, reason: "Duplicate streams are not allowed" };
  if (!names.includes(MANAGER_EVENT_STREAM))
    return { accepted: false, reason: "The manager stream is required" };
  const sandboxStreams = names.filter((stream) =>
    stream.startsWith("sandbox:"),
  );
  if (
    names.some(
      (stream) =>
        stream !== MANAGER_EVENT_STREAM && !stream.startsWith("sandbox:"),
    )
  )
    return { accepted: false, reason: "Unknown stream" };
  if (sandboxStreams.length > 1)
    return {
      accepted: false,
      reason: "Only one sandbox stream may be selected",
    };
  const sandboxId = sandboxStreams[0]?.slice("sandbox:".length);
  if (sandboxId && !(await state.sandboxes.get(sandboxId)))
    return { accepted: false, reason: "Sandbox stream was not found" };
  return { accepted: true };
}

async function loadStreamState(
  state: ManagerState,
  stream: string,
  observedHighWater: ReadonlyMap<
    string,
    { latestSeq: number; durableSeq: number }
  >,
): Promise<StreamState> {
  const storeId = storeIdForStream(stream);
  if (!storeId) throw new Error(`Unknown manager UI stream: ${stream}`);
  const summary = await state.events.streamState(storeId);
  const observed = observedHighWater.get(stream);
  return {
    stream,
    latestSeq: Math.max(summary.latestSeq, observed?.latestSeq ?? 0),
    durableSeq: Math.max(summary.durableSeq, observed?.durableSeq ?? 0),
    replayAvailableFromSeq:
      summary.firstDurableSeq !== undefined
        ? Math.max(0, summary.firstDurableSeq - 1)
        : 0,
  };
}

function storeIdForStream(stream: string): string | undefined {
  if (stream === MANAGER_EVENT_STREAM) return MANAGER_EVENT_STORE_ID;
  return stream.startsWith("sandbox:")
    ? stream.slice("sandbox:".length)
    : undefined;
}

function toStoredEnvelope(
  event: StoredSandboxEvent,
): EventEnvelope<Record<string, unknown>> {
  if (
    !event.id ||
    event.seq === undefined ||
    !event.ts ||
    !event.durability ||
    !isRecord(event.payload)
  )
    throw new Error("Stored protocol events require complete envelopes");
  return {
    id: event.id,
    seq: event.seq,
    type: event.type,
    ts: event.ts,
    durability: event.durability,
    data: event.payload,
  };
}

function toEnvelope(
  event: ManagerEvent,
): EventEnvelope<Record<string, unknown>> {
  return {
    id: event.id,
    seq: event.seq,
    type: event.type,
    ts: event.ts,
    durability: event.durability,
    data: event.payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
