import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  ackMessageSchema,
  goodbyeMessageSchema,
  heartbeatMessageSchema,
  helloMessageSchema,
  type NerveMessage,
  nerveMessageSchema,
  readyMessageSchema,
  replayRequestMessageSchema,
  type SandboxProtocolMessage,
  sandboxProtocolErrorSchema,
  sandboxProtocolEventBatchSchema,
  sandboxProtocolGoodbyeSchema,
  sandboxProtocolHeartbeatSchema,
  sandboxProtocolHelloSchema,
  sandboxProtocolReadySchema,
  sandboxProtocolReplayRequestSchema,
  sandboxProtocolResponseSchema,
} from "@nervekit/contracts";
import { WebSocket, WebSocketServer } from "ws";
import type { ManagerState } from "../app/manager-state.js";
import {
  MANAGER_EVENT_STREAM,
  recordManagerLifecycleEvent,
} from "../events/manager-events.js";
import { SandboxEventIngestor } from "../events/sandbox-event-ingestor.js";
import { extractSandboxToken, timingSafeTokenEquals } from "../http/auth.js";
import { transitionSandboxLifecycle } from "../lifecycle/lifecycle-state.js";
import { CommandForwarder } from "./command-forwarder.js";
import { managerEventBatch } from "./manager-protocol-event-batch.js";
import {
  createUiProtocolSession,
  makeManagerMessage,
  type UiProtocolSession,
  updateUiSessionAck,
} from "./manager-protocol-session.js";
import {
  handleUiReplayRequest,
  uiWelcomeStreams,
} from "./manager-ui-replay.js";
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
    this.ingestor = new SandboxEventIngestor(
      state.events,
      state.eventBus,
      state.activity,
    );
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
      if (
        !timingSafeTokenEquals(
          extractSandboxToken(req),
          record.controller.token,
        )
      )
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
    let session: UiProtocolSession | undefined;
    const send = (message: NerveMessage<unknown>): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    const fail = (code: string, message: string): void => {
      send(
        makeManagerMessage("error", {
          code,
          message,
          retryable: false,
        }),
      );
      ws.close(1008, code);
    };
    const helloTimer = setTimeout(
      () => fail("HELLO_TIMEOUT", "UI hello was not received in time"),
      10_000,
    );
    const cleanupHelloTimer = () => clearTimeout(helloTimer);
    ws.once("message", async (data) => {
      cleanupHelloTimer();
      try {
        const hello = helloMessageSchema.parse(JSON.parse(String(data)));
        const targetPeer = hello.source ?? {
          role: "ui" as const,
          id: "sandbox-manager-ui",
          name: "Nerve Sandbox Manager UI",
        };
        session = createUiProtocolSession({
          source: targetPeer,
          resume: hello.data.resume,
        });
        const capabilities = acceptedCapabilities(
          hello.data.capabilities,
          UI_CAPABILITIES,
        );
        if (!hello.data.encodings.includes("json")) {
          fail("CAPABILITY_MISSING", "json encoding is required");
          return;
        }
        send(
          makeManagerMessage(
            "welcome",
            {
              sessionId: session.sessionId,
              orchestrator: {
                id: "sandbox-manager",
                instanceId: "sandbox-manager",
              },
              acceptedVersion: 1,
              capabilities,
              encoding: "json",
              streams: await uiWelcomeStreams(
                this.state,
                Array.from(session.subscribedStreams),
              ),
              limits: {
                maxMessageBytes: 1_000_000,
                maxBatchEvents: 1_000,
                maxBatchBytes: 1_000_000,
                maxInflightBatches: 16,
                maxUnackedDurableEvents: 10_000,
              },
              heartbeat: {
                intervalMs: 15_000,
                timeoutMs: this.state.config.heartbeatTimeoutMs,
              },
              resume: {
                accepted: true,
                mode: hello.data.resume?.streams?.length ? "replay" : "live",
              },
            },
            { target: targetPeer },
          ),
        );
        unsubscribe = this.state.eventBus.subscribe((event) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const stream = event.stream ?? MANAGER_EVENT_STREAM;
          if (!session?.subscribedStreams.has(stream)) return;
          const isDurable = event.durability === "durable";
          // Transient events (streaming deltas) occupy seq numbers between
          // durable events, so a durable event's predecessor is the last durable
          // seq we actually sent on this stream — not `seq - 1`. Using `seq - 1`
          // makes the client see a false gap and drop the batch, which blocks all
          // further live events (no streaming/thinking is rendered).
          const previousDurableSeq = isDurable
            ? (session.latestSentSeqs.get(stream) ?? 0)
            : undefined;
          const batch = managerEventBatch({
            stream,
            batchId: `batch_${stream}_${event.seq ?? Date.now()}`,
            reason: "live",
            events: [event],
            previousDurableSeq,
          });
          send(makeManagerMessage("event.batch", batch));
          if (isDurable && typeof event.seq === "number")
            session.latestSentSeqs.set(stream, event.seq);
        });
        const uiSession = session;
        ws.on(
          "message",
          (next) => void this.handleUiMessage(ws, next as Buffer, uiSession),
        );
      } catch (error) {
        fail(
          "INVALID_HELLO",
          error instanceof Error ? error.message : "Invalid hello",
        );
      }
    });
    ws.on("close", () => {
      cleanupHelloTimer();
      unsubscribe?.();
    });
    ws.on("error", () => {
      cleanupHelloTimer();
      unsubscribe?.();
    });
  }
  private async handleUiMessage(
    ws: WebSocket,
    data: Buffer,
    session: UiProtocolSession,
  ): Promise<void> {
    const send = (message: NerveMessage<unknown>): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    let message: NerveMessage<unknown>;
    try {
      message = nerveMessageSchema.parse(JSON.parse(String(data)));
    } catch {
      send(
        makeManagerMessage("error", {
          code: "INVALID_MESSAGE",
          message: "Invalid JSON or Nerve message",
          retryable: false,
        }),
      );
      return;
    }
    if (message.kind === "ack") {
      const ack = ackMessageSchema.parse(message);
      if (ack.data.sessionId !== session.sessionId) {
        send(
          makeManagerMessage("error", {
            code: "INVALID_SESSION",
            message: "Ack sessionId does not match this websocket session",
            retryable: false,
          }),
        );
        return;
      }
      updateUiSessionAck(session, ack.data.streams);
      return;
    }
    if (message.kind === "heartbeat") {
      const heartbeat = heartbeatMessageSchema.parse(message);
      session.heartbeat.lastReceivedAt = new Date().toISOString();
      send(
        makeManagerMessage("heartbeat", {
          sessionId: session.sessionId,
          sentAt: new Date().toISOString(),
          processed: heartbeat.data.processed,
        }),
      );
      return;
    }
    if (message.kind === "ready") {
      readyMessageSchema.parse(message);
      return;
    }
    if (message.kind === "goodbye") {
      goodbyeMessageSchema.parse(message);
      ws.close(1000, "goodbye");
      return;
    }
    if (message.kind === "replay.request") {
      const request = replayRequestMessageSchema.parse(message);
      await handleUiReplayRequest(this.state, session, request.data, send);
      return;
    }
    send(
      makeManagerMessage("error", {
        code: "UNSUPPORTED_MESSAGE",
        message: `Unsupported UI message: ${message.kind}`,
        retryable: false,
      }),
    );
  }

  private async handleConnection(
    sandboxId: string,
    ws: WebSocket,
  ): Promise<void> {
    let session: ConnectedSandboxSession | undefined;
    const fail = (code: string, message: string): void => {
      this.state.logger.warn("controller handshake rejected", {
        sandboxId,
        code,
        reason: message,
      });
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
    const cleanupHelloTimer = () => clearTimeout(helloTimer);

    ws.once("message", async (data) => {
      cleanupHelloTimer();
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
        const forwarder = new CommandForwarder({
          logger: this.state.logger.child({ sandboxId, sessionId }),
        });
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
          connectedAt: now,
          agentStatus: "booting",
          cursors: hello.resume?.cursors,
          capabilities,
        });
        const connectedRecord = await transitionSandboxLifecycle(
          {
            store: this.state.sandboxes,
            recordEvent: (event) =>
              recordManagerLifecycleEvent(this.state, event),
          },
          sandboxId,
          "daemon_connected",
          {
            observedState: "running",
            instanceId: hello.instanceId,
            daemon: { sessionId, connectedAt: now, lastHeartbeatAt: now },
            force: true,
          },
        );
        await this.state.sandboxes.put({
          ...connectedRecord,
          controller: {
            token: controllerMetadata.token,
            url: controllerMetadata.url,
            sessionId,
          },
        });
        await recordManagerLifecycleEvent(this.state, {
          type: "manager.sandbox.daemon_connected",
          sandboxId,
          payload: {
            sandboxId,
            instanceId: hello.instanceId,
            sessionId,
            lifecycleState: "daemon_connected",
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
        this.state.logger.info("controller session connected", {
          sandboxId,
          sessionId,
          instanceId: hello.instanceId,
          capabilities: capabilities.length,
        });
        session.heartbeat = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            encodeProtocolMessage({
              type: "heartbeat",
              ts: new Date().toISOString(),
              status: "ok",
              sessionId,
            }),
          );
        }, 15_000);
        session.heartbeat.unref();
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

    ws.on("close", (code, reason) => {
      cleanupHelloTimer();
      this.safeHandleClose(sandboxId, session, code, reason.toString());
    });
    ws.on("error", (error) => {
      cleanupHelloTimer();
      this.safeHandleClose(sandboxId, session, undefined, error.message);
    });
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
      const now = new Date().toISOString();
      session.readyAt = now;
      session.agentStatus = ready.status;
      await this.state.sessions.put({
        sandboxId: session.sandboxId,
        sessionId: session.sessionId,
        state: "connected",
        updatedAt: now,
        connectedAt: session.connectedAt,
        readyAt: now,
        agentStatus: ready.status,
        cursors: ready.cursors,
      });
      await transitionSandboxLifecycle(
        {
          store: this.state.sandboxes,
          recordEvent: (event) =>
            recordManagerLifecycleEvent(this.state, event),
        },
        session.sandboxId,
        ready.status,
        {
          daemon: {
            sessionId: session.sessionId,
            connectedAt: session.connectedAt,
            readyAt: now,
            lastHeartbeatAt: session.lastHeartbeatAt,
          },
          force: true,
        },
      );
      await recordManagerLifecycleEvent(this.state, {
        type: "manager.sandbox.ready",
        sandboxId: session.sandboxId,
        payload: {
          sandboxId: session.sandboxId,
          instanceId: session.instanceId,
          sessionId: session.sessionId,
          status: ready.status,
          readyAt: now,
        },
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
        connectedAt: session.connectedAt,
        readyAt: session.readyAt,
        agentStatus: session.agentStatus ?? "booting",
        cursors: message.cursors,
      });
      const record = await this.state.sandboxes.get(session.sandboxId);
      if (record?.daemon?.sessionId === session.sessionId) {
        await this.state.sandboxes.put({
          ...record,
          daemon: {
            ...record.daemon,
            lastHeartbeatAt: session.lastHeartbeatAt,
          },
          updatedAt: session.lastHeartbeatAt,
        });
      }
      return;
    }
    if (message.type === "event.batch") {
      const batch = sandboxProtocolEventBatchSchema.parse(message);
      const result = await this.ingestor.ingestBatch(
        session.sandboxId,
        batch.events,
      );
      if (
        result.accepted > 0 &&
        batch.events.some((event) => isBootProgressEvent(event.type))
      ) {
        const record = await this.state.sandboxes.get(session.sandboxId);
        if (record?.lifecycleState === "daemon_connected") {
          await transitionSandboxLifecycle(
            {
              store: this.state.sandboxes,
              recordEvent: (event) =>
                recordManagerLifecycleEvent(this.state, event),
            },
            session.sandboxId,
            "booting",
            { daemon: { sessionId: session.sessionId } },
          );
        }
      }
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

  private safeHandleClose(
    sandboxId: string,
    session?: ConnectedSandboxSession,
    closeCode?: number,
    closeReason?: string,
  ): void {
    void this.handleClose(sandboxId, session, closeCode, closeReason).catch(
      () => undefined,
    );
  }

  private async handleClose(
    sandboxId: string,
    session?: ConnectedSandboxSession,
    closeCode?: number,
    closeReason?: string,
  ): Promise<void> {
    if (!session) return;
    const removedCurrent = this.sessions.delete(sandboxId, session.sessionId);
    if (session.heartbeat) clearInterval(session.heartbeat);
    const pending = session.forwarder.pendingCount();
    session.forwarder.failAll(new Error("Sandbox session disconnected"));
    this.state.logger.info("controller session disconnected", {
      sandboxId,
      sessionId: session.sessionId,
      closeCode,
      closeReason: closeReason?.trim() || undefined,
      pendingCommands: pending,
      current: removedCurrent,
    });
    if (!removedCurrent) return;
    const now = new Date().toISOString();
    await this.state.sessions.put({
      sandboxId,
      sessionId: session.sessionId,
      state: "disconnected",
      updatedAt: now,
      connectedAt: session.connectedAt,
      readyAt: session.readyAt,
      agentStatus: session.agentStatus,
      disconnectedAt: now,
      closeCode,
      closeReason: closeReason?.trim() || undefined,
    });
    const record = await this.state.sandboxes.get(sandboxId);
    if (
      record?.desiredState === "running" &&
      ["ready", "degraded", "booting", "daemon_connected"].includes(
        record.lifecycleState,
      )
    ) {
      await transitionSandboxLifecycle(
        {
          store: this.state.sandboxes,
          recordEvent: (event) =>
            recordManagerLifecycleEvent(this.state, event),
        },
        sandboxId,
        "reconnecting",
        {
          daemon: {
            sessionId: session.sessionId,
            connectedAt: session.connectedAt,
            readyAt: session.readyAt,
            lastHeartbeatAt: session.lastHeartbeatAt,
          },
        },
      );
    }
  }
}

function isBootProgressEvent(type: string): boolean {
  return (
    type.startsWith("sandbox.startup.stage.") ||
    type.startsWith("sandbox.preflight.") ||
    type.startsWith("sandbox.models.") ||
    type.startsWith("sandbox.context.") ||
    type === "sandbox.config.loaded" ||
    type === "sandbox.secret_store.checked" ||
    type.startsWith("sandbox.setup.") ||
    type.startsWith("sandbox.boot.") ||
    type === "sandbox.skills.loaded" ||
    type === "sandbox.ready"
  );
}

function matchSandboxId(url: string): string | undefined {
  return /^\/api\/sandboxes\/([^/]+)\/ws(?:\?|$)/.exec(url)?.[1];
}

function matchManagerUiWs(url: string): boolean {
  return /^\/api\/manager\/ws(?:\?|$)/.test(url);
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}
