import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  createMessageFactory,
  ProtocolConnection,
  ProtocolServerSession,
  websocketTransport,
  type WebSocketLike,
} from "@nervekit/protocol";
import {
  parseConversationStream,
  type ProtocolV1Message,
} from "@nervekit/contracts";
import type WebSocket from "ws";
import type { WebSocketServer } from "ws";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { isWebSocketAuthorized } from "../app/server.js";
import {
  PROTOCOL_CAPABILITIES,
  PROTOCOL_HEARTBEAT,
  PROTOCOL_SESSION_LIMITS,
  WORKSPACE_STREAM,
  conversationStream,
} from "./constants.js";
import { workbenchWebSocketRpcDispatcher } from "./http-dispatcher.js";
import { orchestratorSource } from "./messages.js";

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
  let unsubscribeSequenced: () => void = () => undefined;
  let unsubscribeNotify: () => void = () => undefined;

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribeSequenced();
    unsubscribeNotify();
    session.dispose();
    connection.dispose();
    onDispose();
  };
  const closeProtocolError = async () => {
    if (disposed) return;
    unsubscribeSequenced();
    unsubscribeNotify();
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
    limits: PROTOCOL_SESSION_LIMITS,
    heartbeat: PROTOCOL_HEARTBEAT,
    sessionId: () => `ses_${crypto.randomUUID()}`,
    send: async (message): Promise<void> => {
      await connection.send(message as ProtocolV1Message);
    },
    close: async (code, reason) => transport.close(code, reason),
    rpcDispatcher: ({ capabilities }) =>
      workbenchWebSocketRpcDispatcher(state, capabilities),
    subscriptions: {
      async resolve(cursors) {
        // Resolve each stream independently. Unknown or deleted streams are
        // omitted and degrade to "unavailable" in the session layer; they
        // must not reject the whole set and silence every other stream.
        const streams = [];
        for (const cursor of cursors) {
          try {
            if (cursor.stream === WORKSPACE_STREAM) {
              streams.push(await state.events.bounds(cursor.stream));
              continue;
            }
            const conversationId = parseConversationStream(cursor.stream);
            if (!conversationId) {
              throw new Error(`Unknown stream ${cursor.stream}`);
            }
            state.registry.getConversation(conversationId);
            streams.push(await state.events.bounds(cursor.stream));
          } catch (error) {
            state.logger.warn("Stream subscription entry unavailable", {
              context: { stream: cursor.stream },
              error: boundedError(error),
            });
          }
        }
        return { accepted: true, streams };
      },
    },
    readStream: (stream, fromSeq, limit) =>
      state.events.readStream(stream, fromSeq, limit),
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
  unsubscribeSequenced = state.events.subscribeSequenced((stream, event) => {
    void session.publish(stream, event).catch((error: unknown) => {
      if (disposed) return;
      state.logger.warn("Protocol event publication failed", {
        error: boundedError(error),
      });
      dispose();
    });
    if (event.type === "conversation.deleted") {
      const conversationId = (event.data as { conversationId?: unknown })
        .conversationId;
      if (typeof conversationId === "string") {
        session.removeStream(conversationStream(conversationId));
      }
    }
  });
  unsubscribeNotify = state.events.subscribeNotify((event) => {
    void session.notify(event).catch((error: unknown) => {
      if (disposed) return;
      state.logger.warn("Protocol notify publication failed", {
        error: boundedError(error),
      });
      dispose();
    });
  });

  return {
    dispose,
    async shutdown(message = "Daemon shutting down") {
      if (disposed) return;
      unsubscribeSequenced();
      unsubscribeNotify();
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
