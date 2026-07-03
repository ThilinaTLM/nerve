import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  type SandboxProtocolMessage,
  sandboxProtocolAckSchema,
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
import {
  MANAGER_EVENT_STORE_ID,
  MANAGER_EVENT_STREAM,
} from "../events/manager-events.js";
import { SandboxEventIngestor } from "../events/sandbox-event-ingestor.js";
import type { StoredSandboxEvent } from "../state/event-store.js";
import { CommandForwarder } from "./command-forwarder.js";
import { encodeProtocolMessage, parseProtocolMessage } from "./messages.js";
import { replayEvents } from "./replay.js";
import {
  type ConnectedSandboxSession,
  SandboxSessionRegistry,
} from "./sandbox-session.js";

type ManagerHttpAuthorizer = (
  state: ManagerState,
  req: IncomingMessage,
) => boolean;

const CONTROLLER_CAPABILITIES = new Set([
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "sandbox.runtime.v1",
  "sandbox.commands.v1",
  "sandbox.events.v1",
  "sandbox.snapshots.v1",
  "sandbox.models.pi_ai.v1",
  "sandbox.credentials.oauth_refresh.v1",
  "sandbox.secret_stores.v1",
  "sandbox.git_config.v1",
  "sandbox.github_config.v1",
  "sandbox.tool_groups.v1",
  "sandbox.tools.web_search.v1",
  "sandbox.tools.jira.v1",
  "sandbox.tools.confluence.v1",
  "sandbox.skills.v1",
  "sandbox.disconnect_exit.v1",
  "sandbox.multi_agent_state.v1",
  "sandbox.network.egress_policy.v1",
]);

const UI_CAPABILITIES = new Set([
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "sandbox.manager.ui.v1",
  "sandbox.manager.snapshots.v1",
  "sandbox.manager.lifecycle.v1",
]);

function acceptedCapabilities(
  advertised: readonly string[],
  allowed = CONTROLLER_CAPABILITIES,
): string[] {
  return advertised.filter((capability) => allowed.has(capability));
}

export class SandboxWsServer {
  readonly sessions = new SandboxSessionRegistry();
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly ingestor: SandboxEventIngestor;

  constructor(
    private readonly state: ManagerState,
    private readonly authorizeManagerClient: ManagerHttpAuthorizer = () => true,
  ) {
    this.ingestor = new SandboxEventIngestor(state.events, state.eventBus);
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
      if (matchManagerUiWs(req.url ?? "")) {
        if (!this.authorizeManagerClient(this.state, req))
          return rejectUpgrade(socket, 401, "Unauthorized");
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          void this.handleUiConnection(ws);
        });
        return;
      }
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

  private async handleUiConnection(ws: WebSocket): Promise<void> {
    let unsubscribe: (() => void) | undefined;
    let sessionId: string | undefined;
    const fail = (code: string, message: string): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          encodeProtocolMessage({ type: "error", error: { code, message } }),
        );
        ws.close(1008, code);
      }
    };
    const helloTimer = setTimeout(
      () => fail("HELLO_TIMEOUT", "UI hello was not received in time"),
      10_000,
    );
    ws.once("message", (data) => {
      clearTimeout(helloTimer);
      try {
        const hello = parseUiHello(data as Buffer);
        sessionId = `ui_${randomUUID()}`;
        const capabilities = acceptedCapabilities(
          hello.capabilities,
          UI_CAPABILITIES,
        );
        if (!capabilities.includes("encoding.json")) {
          fail("CAPABILITY_MISSING", "encoding.json is required");
          return;
        }
        ws.send(
          encodeProtocolMessage({
            type: "welcome",
            version: 1,
            accepted: true,
            sessionId,
            controllerId: "sandbox-manager",
            acceptedCapabilities: capabilities,
            heartbeatIntervalMs: 15_000,
            heartbeatTimeoutMs: this.state.config.heartbeatTimeoutMs,
            replay: { required: false, cursors: hello.resume?.cursors },
          }),
        );
        unsubscribe = this.state.eventBus.subscribe((event) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            encodeProtocolMessage({
              type: "event.batch",
              batchId: `batch_${event.stream ?? "manager"}_${event.seq ?? Date.now()}`,
              stream: event.stream ?? MANAGER_EVENT_STREAM,
              firstSeq: event.seq,
              lastSeq: event.seq,
              events: [
                {
                  id: event.id,
                  seq: event.seq ?? 1,
                  ts: event.ts,
                  type: event.type,
                  durability: event.durability ?? "durable",
                  data: event.payload,
                },
              ],
            }),
          );
        });
        ws.on(
          "message",
          (next) => void this.handleUiMessage(ws, next as Buffer),
        );
      } catch (error) {
        fail(
          "INVALID_HELLO",
          error instanceof Error ? error.message : "Invalid hello",
        );
      }
    });
    ws.on("close", () => unsubscribe?.());
    ws.on("error", () => unsubscribe?.());
  }

  private async handleUiMessage(ws: WebSocket, data: Buffer): Promise<void> {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      ws.send(
        encodeProtocolMessage({
          type: "error",
          error: { code: "INVALID_MESSAGE", message: "Invalid JSON" },
        }),
      );
      return;
    }
    if (message.type === "ack") {
      sandboxProtocolAckSchema.parse(message);
      return;
    }
    if (message.type === "heartbeat") {
      sandboxProtocolHeartbeatSchema.parse(message);
      ws.send(
        encodeProtocolMessage({
          type: "heartbeat",
          ts: new Date().toISOString(),
          status: "ok",
        }),
      );
      return;
    }
    if (message.type === "ready") return;
    if (message.type === "goodbye") {
      sandboxProtocolGoodbyeSchema.parse(message);
      ws.close(1000, "goodbye");
      return;
    }
    if (message.type === "replay.request") {
      const request = sandboxProtocolReplayRequestSchema.parse(message);
      const storeId = storeIdForUiStream(request.stream);
      const events = storeId
        ? (await replayEvents(this.state.events, storeId, request.afterSeq))
            .slice(0, request.limit ?? 1000)
            .map((event) => toProtocolEventForStream(event))
        : [];
      ws.send(
        encodeProtocolMessage({
          type: "replay.response",
          stream: request.stream,
          afterSeq: request.afterSeq,
          events,
          complete: events.length < (request.limit ?? 1000),
        }),
      );
      return;
    }
    ws.send(
      encodeProtocolMessage({
        type: "error",
        error: {
          code: "UNSUPPORTED_MESSAGE",
          message: `Unsupported UI message: ${String(message.type)}`,
        },
      }),
    );
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
        const capabilities = acceptedCapabilities(hello.capabilities);
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
          capabilities,
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
            acceptedCapabilities: capabilities,
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

    ws.on(
      "close",
      (code, reason) =>
        void this.handleClose(sandboxId, session, code, reason.toString()),
    );
    ws.on(
      "error",
      (error) =>
        void this.handleClose(sandboxId, session, undefined, error.message),
    );
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
      const events = (
        await replayEvents(
          this.state.events,
          session.sandboxId,
          request.afterSeq,
        )
      )
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
    closeCode?: number,
    closeReason?: string,
  ): Promise<void> {
    if (!session) return;
    this.sessions.delete(sandboxId, session.sessionId);
    session.forwarder.failAll(new Error("Sandbox session disconnected"));
    const now = new Date().toISOString();
    await this.state.sessions.put({
      sandboxId,
      sessionId: session.sessionId,
      state: "disconnected",
      updatedAt: now,
      disconnectedAt: now,
      closeCode,
      closeReason,
    });
  }
}

function matchSandboxId(url: string): string | undefined {
  return /^\/api\/sandboxes\/([^/]+)\/ws(?:\?|$)/.exec(url)?.[1];
}

function matchManagerUiWs(url: string): boolean {
  return /^\/api\/manager\/ws(?:\?|$)/.test(url);
}

function parseUiHello(data: Buffer): {
  capabilities: string[];
  resume?: { cursors?: Array<{ stream: string; processedSeq: number }> };
} {
  const value = JSON.parse(String(data)) as Record<string, unknown>;
  if (value.type !== "hello") throw new Error("UI hello type is required");
  if (value.role !== "ui") throw new Error("UI hello role must be ui");
  if (!Array.isArray(value.capabilities))
    throw new Error("UI hello capabilities are required");
  const resume = isRecord(value.resume) ? value.resume : undefined;
  return {
    capabilities: value.capabilities.map(String),
    resume: resume
      ? {
          cursors: Array.isArray(resume.cursors)
            ? resume.cursors.flatMap((cursor) => {
                if (!isRecord(cursor)) return [];
                return typeof cursor.stream === "string" &&
                  typeof cursor.processedSeq === "number"
                  ? [
                      {
                        stream: cursor.stream,
                        processedSeq: cursor.processedSeq,
                      },
                    ]
                  : [];
              })
            : undefined,
        }
      : undefined,
  };
}

function storeIdForUiStream(stream: string): string | undefined {
  if (stream === MANAGER_EVENT_STREAM) return MANAGER_EVENT_STORE_ID;
  if (stream.startsWith("sandbox:")) return stream.slice("sandbox:".length);
  return undefined;
}

function toProtocolEventForStream(event: StoredSandboxEvent) {
  return {
    id: event.id,
    seq: event.seq ?? 1,
    ts: event.ts ?? new Date().toISOString(),
    type: event.type,
    durability: event.durability ?? ("durable" as const),
    data: event.payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
