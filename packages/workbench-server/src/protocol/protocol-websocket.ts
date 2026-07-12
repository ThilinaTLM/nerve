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
  PROTOCOL_LIMITS,
  GLOBAL_STREAM,
} from "./constants.js";
import { workbenchRpcDispatcher } from "./http-dispatcher.js";
import { orchestratorSource } from "./messages.js";

/** Host binding for the shared server lifecycle. */
export interface LocalProtocolSession {
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
      const binding = createLocalSession(ws, state);
      sessions.add(binding);
      ws.on("close", () => sessions.delete(binding));
      ws.on("error", () => sessions.delete(binding));
    });
  });
  return sessions;
}

function createLocalSession(
  ws: WebSocket,
  state: OrchestratorState,
): LocalProtocolSession {
  const peer = orchestratorSource(state.daemonId);
  const messages = createMessageFactory({
    source: peer,
    target: { role: "ui" },
  });
  const transport = websocketTransport(ws as unknown as WebSocketLike);
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
        replayAvailableFromSeq: 1,
      },
    ],
    limits: PROTOCOL_LIMITS,
    heartbeat: PROTOCOL_HEARTBEAT,
    sessionId: () => `ses_${crypto.randomUUID()}`,
    send: async (message): Promise<void> => {
      await connection.send(message as ProtocolV1Message);
    },
    rpcDispatcher: () => workbenchRpcDispatcher(state),
    replaySource: localReplaySource(state),
    resume: (hello) => {
      const cursor = hello.resume?.streams?.find(
        (item) => item.stream === GLOBAL_STREAM,
      );
      if (!cursor) return { accepted: false, mode: "fresh" as const };
      if (cursor.processedSeq > state.events.latestDurableSeq)
        return {
          accepted: false,
          mode: "snapshot_required" as const,
          reason: "Client cursor is ahead of server durable cursor",
        };
      if (cursor.processedSeq < state.events.latestDurableSeq)
        return { accepted: true, mode: "replay" as const };
      return { accepted: true, mode: "live" as const };
    },
  });
  const connection: ProtocolConnection = new ProtocolConnection({
    transport,
    onMessage: async (message): Promise<void> => session.receive(message),
    onProtocolError: () =>
      session.shutdown("protocol_error", "Invalid protocol frame"),
    onError: () =>
      session.shutdown("protocol_error", "WebSocket transport failed"),
  });
  const unsubscribe = state.events.subscribe((event) => {
    if (session.state === "ready") void session.publish(GLOBAL_STREAM, event);
  });
  return {
    async shutdown(message = "Daemon shutting down") {
      unsubscribe();
      await session.shutdown("server_shutdown", message);
      await connection.close(1001, message);
    },
  };
}

function localReplaySource(state: OrchestratorState): ReplaySource {
  return {
    streams(): readonly StreamState[] {
      return [
        {
          stream: GLOBAL_STREAM,
          latestSeq: state.events.latestSeq,
          durableSeq: state.events.latestDurableSeq,
          replayAvailableFromSeq: 1,
        },
      ];
    },
    async read(request) {
      if (request.stream !== GLOBAL_STREAM)
        return { events: [], complete: true };
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
