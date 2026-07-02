import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  type SandboxProtocolMessage,
  sandboxProtocolErrorSchema,
  sandboxProtocolEventBatchSchema,
  sandboxProtocolGoodbyeSchema,
  sandboxProtocolHeartbeatSchema,
  sandboxProtocolHelloSchema,
  sandboxProtocolReadySchema,
  sandboxProtocolReplayRequestSchema,
  sandboxProtocolResponseSchema,
} from "@nervekit/shared";
import { WebSocket, WebSocketServer } from "ws";
import type { ManagerState } from "../app/manager-state.js";
import { SandboxEventIngestor } from "../events/sandbox-event-ingestor.js";
import { CommandForwarder } from "./command-forwarder.js";
import { encodeProtocolMessage, parseProtocolMessage } from "./messages.js";
import {
  type ConnectedSandboxSession,
  SandboxSessionRegistry,
} from "./sandbox-session.js";

export class SandboxWsServer {
  readonly sessions = new SandboxSessionRegistry();
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly ingestor: SandboxEventIngestor;

  constructor(private readonly state: ManagerState) {
    this.ingestor = new SandboxEventIngestor(state.events);
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    void this.acceptUpgrade(req, socket, head);
  }

  getSession(sandboxId: string): ConnectedSandboxSession | undefined {
    return this.sessions.get(sandboxId);
  }

  private async acceptUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      const sandboxId = matchSandboxId(req.url ?? "");
      if (!sandboxId) return rejectUpgrade(socket, 404, "Not found");
      const record = await this.state.sandboxes.get(sandboxId);
      if (!record?.controller?.token)
        return rejectUpgrade(socket, 404, "Unknown sandbox");
      if (!tokenMatches(extractToken(req), record.controller.token))
        return rejectUpgrade(socket, 401, "Unauthorized");
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        void this.handleConnection(sandboxId, ws);
      });
    } catch {
      rejectUpgrade(socket, 500, "Upgrade failed");
    }
  }

  private async handleConnection(
    sandboxId: string,
    ws: WebSocket,
  ): Promise<void> {
    let session: ConnectedSandboxSession | undefined;
    const fail = (code: string, message: string): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          encodeProtocolMessage({ type: "error", error: { code, message } }),
        );
        ws.close(1008, code);
      }
    };

    const helloTimer = setTimeout(
      () => fail("HELLO_TIMEOUT", "Sandbox hello was not received in time"),
      10_000,
    );

    ws.once("message", async (data) => {
      clearTimeout(helloTimer);
      try {
        const hello = sandboxProtocolHelloSchema.parse(
          parseProtocolMessage(data as Buffer),
        );
        if (hello.sandboxId !== sandboxId) {
          fail("SANDBOX_MISMATCH", "Hello sandboxId does not match URL");
          return;
        }
        const record = await this.state.sandboxes.get(sandboxId);
        if (!record?.controller) {
          fail("UNKNOWN_SANDBOX", "Sandbox record is missing");
          return;
        }
        const controllerMetadata = record.controller;
        if (record.instanceId && record.instanceId !== hello.instanceId) {
          // Restarts are allowed while the manager wants the sandbox running.
          if (
            record.desiredState !== "running" &&
            record.desiredState !== "created"
          ) {
            fail("INSTANCE_MISMATCH", "Sandbox instance is not current");
            return;
          }
        }
        const sessionId = `sess_${randomUUID()}`;
        const now = new Date().toISOString();
        const forwarder = new CommandForwarder();
        session = {
          sandboxId,
          instanceId: hello.instanceId,
          sessionId,
          connectedAt: now,
          lastHeartbeatAt: now,
          socket: ws,
          forwarder,
        };
        this.sessions.set(session);
        await this.state.sessions.put({
          sandboxId,
          sessionId,
          state: "connected",
          updatedAt: now,
          cursors: hello.resume?.cursors,
        });
        await this.state.sandboxes.put({
          ...record,
          instanceId: hello.instanceId,
          observedState: "running",
          updatedAt: now,
          controller: {
            token: controllerMetadata.token,
            url: controllerMetadata.url,
            sessionId,
          },
        });
        ws.send(
          encodeProtocolMessage({
            type: "welcome",
            version: 1,
            accepted: true,
            sessionId,
            heartbeatIntervalMs: 15_000,
            replay: {
              required: true,
              fromSeq: hello.resume?.lastAckedSeq ?? 0,
            },
          }),
        );
        ws.on(
          "message",
          (next) =>
            void this.handleMessage(
              session as ConnectedSandboxSession,
              next as Buffer,
            ),
        );
      } catch (error) {
        fail(
          "INVALID_HELLO",
          error instanceof Error ? error.message : "Invalid hello",
        );
      }
    });

    ws.on("close", () => void this.handleClose(sandboxId, session));
    ws.on("error", () => void this.handleClose(sandboxId, session));
  }

  private async handleMessage(
    session: ConnectedSandboxSession,
    data: Buffer,
  ): Promise<void> {
    let message: SandboxProtocolMessage;
    try {
      message = parseProtocolMessage(data);
    } catch (error) {
      session.socket.send(
        encodeProtocolMessage({
          type: "error",
          error: {
            code: "INVALID_MESSAGE",
            message: error instanceof Error ? error.message : "Invalid message",
          },
        }),
      );
      return;
    }
    if (message.type === "ready") {
      const ready = sandboxProtocolReadySchema.parse(message);
      await this.state.sessions.put({
        sandboxId: session.sandboxId,
        sessionId: session.sessionId,
        state: "connected",
        updatedAt: new Date().toISOString(),
        cursors: ready.cursors,
      });
      return;
    }
    if (message.type === "heartbeat") {
      sandboxProtocolHeartbeatSchema.parse(message);
      session.lastHeartbeatAt = new Date().toISOString();
      await this.state.sessions.put({
        sandboxId: session.sandboxId,
        sessionId: session.sessionId,
        state: "connected",
        updatedAt: session.lastHeartbeatAt,
        cursors: message.cursors,
      });
      return;
    }
    if (message.type === "event.batch") {
      const batch = sandboxProtocolEventBatchSchema.parse(message);
      const result = await this.ingestor.ingestBatch(
        session.sandboxId,
        batch.events,
      );
      session.socket.send(
        encodeProtocolMessage({
          type: "ack",
          batchId: batch.batchId,
          stream: batch.stream,
          processedSeq: result.processedSeq,
          accepted: result.accepted,
        }),
      );
      return;
    }
    if (message.type === "response") {
      session.forwarder.resolve(sandboxProtocolResponseSchema.parse(message));
      return;
    }
    if (message.type === "error") {
      session.forwarder.reject(sandboxProtocolErrorSchema.parse(message));
      return;
    }
    if (message.type === "goodbye") {
      sandboxProtocolGoodbyeSchema.parse(message);
      session.socket.close(1000, "goodbye");
      return;
    }
    if (message.type === "replay.request") {
      const request = sandboxProtocolReplayRequestSchema.parse(message);
      const events = (await this.state.events.list(session.sandboxId))
        .filter((event) => (event.seq ?? 0) > request.afterSeq)
        .slice(0, request.limit ?? 1000)
        .map((event) => ({
          id: event.id,
          seq: event.seq ?? 0,
          ts: event.ts ?? new Date().toISOString(),
          type: event.type,
          data: event.payload,
          durability: "durable" as const,
        }));
      session.socket.send(
        encodeProtocolMessage({
          type: "replay.response",
          stream: request.stream,
          afterSeq: request.afterSeq,
          events,
          complete: events.length < (request.limit ?? 1000),
        }),
      );
    }
  }

  private async handleClose(
    sandboxId: string,
    session?: ConnectedSandboxSession,
  ): Promise<void> {
    if (!session) return;
    this.sessions.delete(sandboxId, session.sessionId);
    session.forwarder.failAll(new Error("Sandbox session disconnected"));
    await this.state.sessions.put({
      sandboxId,
      sessionId: session.sessionId,
      state: "disconnected",
      updatedAt: new Date().toISOString(),
    });
  }
}

function matchSandboxId(url: string): string | undefined {
  return /^\/api\/sandboxes\/([^/]+)\/ws(?:\?|$)/.exec(url)?.[1];
}

function extractToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer "))
    return header.slice("Bearer ".length);
  const sandboxToken = req.headers["x-nerve-sandbox-token"];
  if (typeof sandboxToken === "string") return sandboxToken;
  return undefined;
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}
