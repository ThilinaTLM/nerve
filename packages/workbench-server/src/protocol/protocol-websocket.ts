import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  createMessageFactory,
  ProtocolConnection,
  ProtocolServerSession,
  websocketTransport,
  type ReplaySource,
  type WebSocketLike,
} from "@nervekit/protocol";
import type {
  EventEnvelope,
  ProtocolV1Message,
  StreamState,
} from "@nervekit/contracts";
import type WebSocket from "ws";
import type { WebSocketServer } from "ws";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { isWebSocketAuthorized } from "../app/server.js";
import {
  PROTOCOL_CAPABILITIES,
  PROTOCOL_HEARTBEAT,
  PROTOCOL_SESSION_LIMITS,
  GLOBAL_STREAM,
} from "./constants.js";
import { workbenchRpcDispatcher } from "./http-dispatcher.js";
import { orchestratorSource } from "./messages.js";

/** Host binding for the shared server lifecycle. */
export interface LocalProtocolSession {
  dispose(): void;
  shutdown(message?: string): Promise<void>;
}

export interface ProtocolSocketServer {
  on(
    event: "upgrade",
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
}

export function installProtocolWebSocketUpgrade(
  server: ProtocolSocketServer,
  webSockets: WebSocketServer,
  state: OrchestratorState,
  token: string,
): Set<LocalProtocolSession> {
  const sessions = new Set<LocalProtocolSession>();
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(
      request.url ?? "/",
      `http://${state.host}:${state.port}`,
    );
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (!isWebSocketAuthorized(request, token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (ws) => {
      const binding = createLocalProtocolSession(ws, state, () =>
        sessions.delete(binding),
      );
      sessions.add(binding);
      ws.on("close", binding.dispose);
      ws.on("error", binding.dispose);
    });
  });
  return sessions;
}

export function createLocalProtocolSession(
  ws: WebSocket,
  state: OrchestratorState,
  onDispose: () => void = () => undefined,
): LocalProtocolSession {
  const peer = orchestratorSource(state.daemonId);
  const messages = createMessageFactory({
    source: peer,
    target: { role: "ui" },
  });
  const transport = websocketTransport(ws as unknown as WebSocketLike);
  let unsubscribe: () => void = () => undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    session.dispose();
    connection?.dispose();
    onDispose();
  };
  const closeProtocolError = async () => {
    if (disposed) return;
    unsubscribe();
    try {
      await session.shutdown("protocol_error", "Invalid protocol frame");
      connection.dispose();
      await transport.close(1002, "protocol_error");
    } finally {
      dispose();
    }
  };
  const session: ProtocolServerSession = new ProtocolServerSession({
    acceptingPeer: peer,
    allowedPeerRoles: ["ui"],
    createMessage: messages,
    capabilities: PROTOCOL_CAPABILITIES,
    streams: () => [
      {
        stream: GLOBAL_STREAM,
        latestSeq: state.events.latestSeq,
        durableSeq: state.events.latestDurableSeq,
        replayAvailableFromSeq: state.events.replayAvailableFromSeq,
      },
    ],
    limits: PROTOCOL_SESSION_LIMITS,
    heartbeat: PROTOCOL_HEARTBEAT,
    sessionId: () => `ses_${crypto.randomUUID()}`,
    send: async (message): Promise<void> => {
      await connection.send(message as ProtocolV1Message);
    },
    rpcDispatcher: () => workbenchRpcDispatcher(state),
    replaySource: localReplaySource(state),
    resume: async (hello) => {
      const cursor = hello.resume?.streams?.find(
        (item) => item.stream === GLOBAL_STREAM,
      );
      if (!cursor) return { accepted: false, mode: "fresh" as const };
      if (cursor.processedSeq === state.events.latestDurableSeq)
        return { accepted: true, mode: "live" as const };
      const replay = await state.events.canReplayDurableRange(
        cursor.processedSeq,
        state.events.latestDurableSeq,
      );
      if (!replay.available)
        return {
          accepted: false,
          mode: "snapshot_required" as const,
          reason: `Durable replay unavailable: ${replay.reason ?? "retention_gap"}`,
        };
      return { accepted: true, mode: "replay" as const };
    },
  });
  const connection = new ProtocolConnection({
    transport,
    onMessage: async (message): Promise<void> => session.receive(message),
    onProtocolError: () => {
      closeProtocolError().catch((error: unknown) => {
        state.logger.warn("Protocol WebSocket close failed", {
          error: boundedError(error),
        });
        dispose();
      });
    },
    onError: (error) => {
      state.logger.warn("Protocol WebSocket session failed", {
        error: boundedError(error),
      });
      dispose();
    },
  });
  unsubscribe = state.events.subscribe((event) => {
    session.publish(GLOBAL_STREAM, event).catch((error: unknown) => {
      if (disposed) return;
      state.logger.warn("Protocol event publication failed", {
        error: boundedError(error),
      });
      dispose();
    });
  });
  return {
    dispose,
    async shutdown(message = "Daemon shutting down") {
      if (disposed) return;
      unsubscribe();
      try {
        await session.shutdown("server_shutdown", message);
        await connection.close(1001, message);
      } finally {
        dispose();
      }
    },
  };
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

function localReplaySource(state: OrchestratorState): ReplaySource {
  return {
    streams(): readonly StreamState[] {
      return [
        {
          stream: GLOBAL_STREAM,
          latestSeq: state.events.latestSeq,
          durableSeq: state.events.latestDurableSeq,
          replayAvailableFromSeq: state.events.replayAvailableFromSeq,
        },
      ];
    },
    async read(request) {
      if (request.stream !== GLOBAL_STREAM)
        return {
          available: false,
          reason: "stream_not_found" as const,
          latestSeq: 0,
        };
      const toSeq = request.toSeq ?? state.events.latestDurableSeq;
      const availability = await state.events.canReplayDurableRange(
        request.fromSeq - 1,
        toSeq,
      );
      if (!availability.available)
        return {
          available: false,
          reason: availability.reason ?? ("snapshot_required" as const),
          earliestAvailableSeq: state.events.replayAvailableFromSeq,
          latestSeq: state.events.latestDurableSeq,
          recovery: { action: "load_snapshot" as const },
        };
      const replay = await state.events.replayForProtocolSince(
        request.fromSeq - 1,
        {
          toSeq: request.toSeq,
          includeTransientIfAvailable: true,
        },
      );
      const events = replay.events.slice(0, request.limit) as EventEnvelope[];
      const last = events.at(-1)?.seq;
      return {
        available: true,
        events,
        previousDurableSeq: await state.events.previousDurableSeqBefore(
          request.fromSeq,
        ),
        complete: events.length === replay.events.length,
        nextSeq: last === undefined ? request.fromSeq : last + 1,
      };
    },
  };
}
