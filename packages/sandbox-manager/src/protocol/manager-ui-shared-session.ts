import { randomUUID } from "node:crypto";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
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
  "event.notify",
  STREAM_SUBSCRIPTION_CAPABILITY,
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
};

/** Return a synchronous WebSocket attachment callback. */
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
  const activeStreams = new Set<string>();
  const pendingSubscriptionStreams = new Set<string>();
  const pendingSubscriptionEvents = new Map<string, ManagerEvent[]>();
  let disposed = false;
  let closing = false;
  let unsubscribe: () => void = () => undefined;
  let unsubscribeNotify: () => void = () => undefined;
  const binding: { connection?: ProtocolConnection } = {};

  const session = new ProtocolServerSession({
    acceptingPeer: peer,
    allowedPeerRoles: ["ui"],
    createMessage: messages,
    capabilities: CAPABILITIES,
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
    close: (code, reason) => transport.close(code, reason),
    authorizeTarget: async (message, context) => {
      const target = message.target;
      if (
        target.role === context.acceptingPeer.role &&
        target.id === context.acceptingPeer.id &&
        target.instanceId === context.acceptingPeer.instanceId &&
        target.name === context.acceptingPeer.name
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
    readStream: async (stream, fromSeq, limit) => {
      const storeId = storeIdForStream(stream);
      if (!storeId) throw new Error(`Unknown manager UI stream: ${stream}`);
      const range = await state.events.readRange(storeId, fromSeq, limit);
      return {
        stream,
        latestSeq: range.latestSeq,
        earliestAvailableSeq: range.earliestAvailableSeq,
        events: range.events.map(toStoredEnvelope),
      };
    },
    subscriptions: {
      resolve: async (cursors) => {
        const policy = await validateRequestedStreams(state, cursors);
        if (!policy.accepted)
          return { accepted: false, streams: [], reason: policy.reason };

        pendingSubscriptionStreams.clear();
        pendingSubscriptionEvents.clear();
        for (const cursor of cursors)
          pendingSubscriptionStreams.add(cursor.stream);
        try {
          const states = await Promise.all(
            cursors.map((cursor) => loadStreamState(state, cursor.stream)),
          );
          for (const streamState of states)
            streamStates.set(streamState.stream, streamState);
          return { accepted: true, streams: states };
        } catch (error) {
          pendingSubscriptionStreams.clear();
          pendingSubscriptionEvents.clear();
          throw error;
        }
      },
      activate: async (_cursors, states) => {
        activeStreams.clear();
        for (const streamState of states) activeStreams.add(streamState.stream);
        const replayBoundary = new Map(
          states.map((streamState) => [
            streamState.stream,
            streamState.latestSeq,
          ]),
        );
        const buffered = [...pendingSubscriptionEvents.values()]
          .flat()
          .filter(
            (event) => event.seq > (replayBoundary.get(event.stream) ?? 0),
          )
          .sort((left, right) => left.seq - right.seq);
        pendingSubscriptionStreams.clear();
        pendingSubscriptionEvents.clear();
        for (const event of buffered)
          await session.publish(event.stream, toEnvelope(event));
        state.logger.debug("Manager UI subscription updated", {
          streams: states.map((streamState) => streamState.stream),
          bufferedEvents: buffered.length,
        });
      },
    },
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    unsubscribeNotify();
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
    const current = streamStates.get(event.stream);
    if (current) {
      streamStates.set(event.stream, {
        ...current,
        latestSeq: Math.max(current.latestSeq, event.seq),
      });
    }
    if (pendingSubscriptionStreams.has(event.stream)) {
      const pending = pendingSubscriptionEvents.get(event.stream) ?? [];
      pending.push(event);
      pendingSubscriptionEvents.set(event.stream, pending);
      return;
    }
    if (!activeStreams.has(event.stream)) return;
    void session
      .publish(event.stream, toEnvelope(event))
      .catch((error: unknown) =>
        closeForFailure(1011, "publication_failed", error),
      );
  });
  unsubscribeNotify = state.eventBus.subscribeNotify((notification) => {
    if (!activeStreams.has(notification.stream)) return;
    void session
      .notify(notification.event)
      .catch((error: unknown) => closeForFailure(1011, "notify_failed", error));
  });
  ws.once("close", dispose);
  ws.once(
    "error",
    (error) => void closeForFailure(1011, "socket_error", error),
  );
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
): Promise<StreamState> {
  const storeId = storeIdForStream(stream);
  if (!storeId) throw new Error(`Unknown manager UI stream: ${stream}`);
  const summary = await state.events.streamState(storeId);
  return {
    stream,
    latestSeq: summary.latestSeq,
    earliestAvailableSeq: summary.earliestAvailableSeq,
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
  if (!isRecord(event.payload))
    throw new Error("Stored protocol events require object data");
  return {
    id: event.id,
    seq: event.seq,
    type: event.type,
    ts: event.ts,
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
    data: event.payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
