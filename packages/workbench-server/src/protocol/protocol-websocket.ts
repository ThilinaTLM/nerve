import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type WebSocket from "ws";
import type { WebSocketServer } from "ws";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { isWebSocketAuthorized } from "../app/server.js";
import { ProtocolSession } from "./protocol-session.js";

type AliveWebSocket = WebSocket & { isAlive?: boolean };

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
): Set<ProtocolSession> {
  const sessions = new Set<ProtocolSession>();
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head) => {
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
      (ws as AliveWebSocket).isAlive = true;
      ws.on("pong", () => {
        (ws as AliveWebSocket).isAlive = true;
      });
      const session = new ProtocolSession(ws, state);
      sessions.add(session);
      ws.on("close", () => sessions.delete(session));
      ws.on("error", () => sessions.delete(session));
      session.start();
    });
  });
  return sessions;
}
