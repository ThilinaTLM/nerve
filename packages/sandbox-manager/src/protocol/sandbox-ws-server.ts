import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  allOperationDefinitions,
  operationNameSchema,
  type ManagedSandboxRecord,
  type ProtocolV1Message,
} from "@nervekit/contracts";
import {
  createMessageFactory,
  ProtocolConnection,
  ProtocolServerSession,
  websocketTransport,
  type WebSocketLike,
} from "@nervekit/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { ManagerState } from "../app/manager-state.js";
import { recordManagerLifecycleEvent } from "../events/manager-events.js";
import { SandboxEventIngestor } from "../events/sandbox-event-ingestor.js";
import type { StoredSandboxEvent } from "../state/event-store.js";
import { extractSandboxToken, timingSafeTokenEquals } from "../http/auth.js";
import { transitionSandboxLifecycle } from "../lifecycle/lifecycle-state.js";
import { prepareManagerUiSharedSession } from "./manager-ui-shared-session.js";
import { RpcForwarder } from "./rpc-forwarder.js";
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
  ...allOperationDefinitions()
    .filter((definition) =>
      definition.allowedTargetRoles.includes("sandbox_agent"),
    )
    .map((definition) => definition.requiredCapability),
  "sandbox.network.egress_policy.v1",
]);

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
      state.logger,
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
        // Attach protocol listeners synchronously at upgrade. Stream state is
        // resolved lazily by resume/subscription callbacks after hello arrives.
        const attach = prepareManagerUiSharedSession(this.state, this);
        this.wss.handleUpgrade(req, socket, head, attach);
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
      // Finish durable session lookup before completing the WebSocket upgrade.
      // A protocol client sends hello immediately after open; awaiting storage
      // after upgrade would leave a window where that first frame is lost.
      const persistedEvents = await this.state.events.list(sandboxId);
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        void this.acceptAgentConnection(
          sandboxId,
          ws,
          record,
          persistedEvents,
        ).catch((error) => {
          this.state.logger.warn("Sandbox protocol connection setup failed", {
            sandboxId,
            error: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 512),
          });
          ws.close(1011, "session_setup_failed");
        });
      });
    } catch {
      rejectUpgrade(socket, 500, "Upgrade failed");
    }
  }

  async acceptAgentConnection(
    sandboxId: string,
    ws: WebSocket,
    preparedRecord?: ManagedSandboxRecord,
    preparedEvents?: readonly StoredSandboxEvent[],
  ): Promise<void> {
    const record =
      preparedRecord ?? (await this.state.sandboxes.get(sandboxId));
    if (!record?.controller) {
      ws.close(1008, "unknown_sandbox");
      return;
    }
    const peer = { role: "sandbox_manager" as const, id: "sandbox-manager" };
    const messages = createMessageFactory({
      source: peer,
      target: { role: "sandbox_agent", id: sandboxId },
    });
    const transport = websocketTransport(ws as unknown as WebSocketLike);
    let connected: ConnectedSandboxSession | undefined;
    let disposed = false;
    const persistedEvents =
      preparedEvents ?? (await this.state.events.list(sandboxId));
    const managerProcessedSeq = Math.max(
      0,
      ...persistedEvents
        .filter((event) => event.durability !== "transient")
        .map((event) => event.seq ?? 0),
    );
    const agentStream = `sandbox:${sandboxId}`;
    const protocolSession: ProtocolServerSession = new ProtocolServerSession({
      acceptingPeer: peer,
      allowedPeerRoles: ["sandbox_agent"],
      createMessage: messages,
      capabilities: [...CONTROLLER_CAPABILITIES],
      streams: () => [
        {
          stream: agentStream,
          latestSeq: managerProcessedSeq,
          durableSeq: managerProcessedSeq,
          replayAvailableFromSeq: managerProcessedSeq,
        },
      ],
      limits: {
        maxMessageBytes: 1_000_000,
        maxBatchEvents: 1_000,
        maxBatchBytes: 1_000_000,
        maxInflightBatches: 16,
        maxUnackedDurableEvents: 10_000,
      },
      heartbeat: { intervalMs: 15_000, timeoutMs: 45_000 },
      sessionId: () => `sess_${randomUUID()}`,
      send: async (message) => {
        await connection.send(message as ProtocolV1Message);
      },
      resume: (hello, source) => {
        if (source.id !== sandboxId || !source.instanceId)
          throw new Error("Sandbox agent identity does not match the endpoint");
        const claimedCursor =
          hello.resume?.streams?.find((cursor) => cursor.stream === agentStream)
            ?.processedSeq ?? 0;
        if (claimedCursor > managerProcessedSeq)
          throw new Error("Agent resume cursor is ahead of manager ingestion");
        if (
          record.instanceId &&
          record.instanceId !== source.instanceId &&
          record.desiredState !== "running" &&
          record.desiredState !== "created"
        )
          throw new Error("Sandbox instance is not current");
        return { accepted: true, mode: "live" as const };
      },
      onReady: async (ready) => {
        const instanceId = protocolSession.peer?.instanceId;
        if (!instanceId || !protocolSession.sessionId)
          throw new Error("Sandbox identity/session missing at ready");
        const now = new Date().toISOString();
        const sessionId = protocolSession.sessionId;
        // The protocol ready frame means "transport + event streaming ready".
        // Sandbox agents must always report their host startup state here:
        // "booting" while startup continues (readiness then arrives through the
        // durable `sandbox.ready` event), or "ready"/"degraded". A missing
        // status is a protocol error at this boundary.
        if (!ready.data.status)
          throw new Error(
            "Sandbox agent ready frame is missing the required status",
          );
        const agentStatus = ready.data.status;
        const booting = agentStatus === "booting";
        const readyAt = booting ? undefined : (record.daemon?.readyAt ?? now);
        const forwarder = new RpcForwarder(sandboxId, {
          logger: this.state.logger.child({ sandboxId, sessionId }),
          request: (method, params, options) =>
            protocolSession.request(
              operationNameSchema.parse(method),
              params as never,
              options,
            ),
        });
        connected = {
          sandboxId,
          instanceId,
          sessionId,
          connectedAt: now,
          readyAt,
          lastHeartbeatAt: now,
          agentStatus,
          socket: ws,
          forwarder,
        };
        this.sessions.set(connected);
        await this.state.sessions.put({
          sandboxId,
          sessionId,
          state: "connected",
          updatedAt: now,
          connectedAt: now,
          readyAt,
          agentStatus,
          cursors: ready.data.streams,
          capabilities: protocolSession.peer
            ? [...CONTROLLER_CAPABILITIES]
            : [],
        });
        const connectedRecord = await transitionSandboxLifecycle(
          this.lifecycleContext(),
          sandboxId,
          booting ? "daemon_connected" : agentStatus,
          {
            observedState: "running",
            instanceId,
            daemon: {
              sessionId,
              connectedAt: now,
              ...(readyAt ? { readyAt } : {}),
              lastHeartbeatAt: now,
            },
            force: true,
          },
        );
        await this.state.sandboxes.put({
          ...connectedRecord,
          controller: {
            ...record.controller,
            token: record.controller?.token ?? "",
            sessionId,
          },
        });
      },
      onEventBatch: async (message) => {
        const expectedStream = `sandbox:${sandboxId}`;
        if (message.data.stream !== expectedStream)
          throw new Error(
            "Sandbox event stream does not match authenticated identity",
          );
        const result = await this.ingestor.ingestBatch(
          sandboxId,
          message.data.range.previousDurableSeq ?? 0,
          message.data.events,
        );
        await this.applyStartupSignals(sandboxId, result.acceptedEvents).catch(
          (error) => {
            this.state.logger.warn("Failed to apply sandbox startup signals", {
              sandboxId,
              error: (error instanceof Error
                ? error.message
                : String(error)
              ).slice(0, 512),
            });
          },
        );
        return {
          streams: [
            { stream: expectedStream, processedSeq: result.processedSeq },
          ],
          appliedEvents: result.accepted,
        };
      },
    });
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      protocolSession.dispose();
      connection.dispose();
    };
    const connection: ProtocolConnection = new ProtocolConnection({
      transport,
      onMessage: (message) => protocolSession.receive(message),
      onProtocolError: () => {
        void protocolSession
          .shutdown("protocol_error", "Invalid protocol frame")
          .then(() => transport.close(1002, "protocol_error"))
          .finally(dispose);
      },
      onError: (error) => {
        this.state.logger.warn("Sandbox protocol session failed", {
          sandboxId,
          error: (error instanceof Error ? error.message : String(error)).slice(
            0,
            512,
          ),
        });
        void Promise.resolve(transport.close(1008, "session_rejected")).finally(
          dispose,
        );
      },
    });
    ws.on("close", (code, reason) => {
      dispose();
      this.safeHandleClose(sandboxId, connected, code, reason.toString());
    });
    ws.on("error", (error) => {
      dispose();
      this.safeHandleClose(sandboxId, connected, undefined, error.message);
    });
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
      pendingOperations: pending,
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
        this.lifecycleContext(),
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

  private lifecycleContext() {
    return {
      store: this.state.sandboxes,
      recordEvent: (event: Parameters<typeof recordManagerLifecycleEvent>[1]) =>
        recordManagerLifecycleEvent(this.state, event),
      logger: this.state.logger,
    };
  }

  /**
   * Derive lifecycle transitions from live startup events: the first startup
   * stage moves `daemon_connected` → `booting`, a failed stage records the
   * precise error, and the durable `sandbox.ready` event announces readiness.
   */
  private async applyStartupSignals(
    sandboxId: string,
    events: readonly StoredSandboxEvent[],
  ): Promise<void> {
    const startupSeen = events.some((event) =>
      event.type.startsWith("sandbox.startup.stage."),
    );
    const readyEvent = findLastEvent(
      events,
      (event) => event.type === "sandbox.ready",
    );
    const failedStage = findLastEvent(
      events,
      (event) =>
        event.type === "sandbox.startup.stage.completed" &&
        asRecord(event.payload)?.status === "failed",
    );
    if (!startupSeen && !readyEvent) return;
    const record = await this.state.sandboxes.get(sandboxId);
    if (!record) return;
    if (readyEvent) {
      const payload = asRecord(readyEvent.payload);
      const status = payload?.status === "degraded" ? "degraded" : "ready";
      const readyAt =
        typeof payload?.readyAt === "string"
          ? payload.readyAt
          : (readyEvent.ts ?? new Date().toISOString());
      await transitionSandboxLifecycle(
        this.lifecycleContext(),
        sandboxId,
        status,
        {
          observedState: "running",
          daemon: { readyAt },
          force: true,
        },
      );
      const live = this.sessions.get(sandboxId);
      if (live) {
        live.agentStatus = status;
        live.readyAt = readyAt;
      }
      const stored = await this.state.sessions.get(sandboxId);
      if (stored?.state === "connected") {
        await this.state.sessions.put({
          ...stored,
          agentStatus: status,
          readyAt,
          updatedAt: new Date().toISOString(),
        });
      }
      return;
    }
    if (failedStage) {
      const payload = asRecord(failedStage.payload);
      const stage =
        typeof payload?.stage === "string" ? payload.stage : "startup";
      const failure = asRecord(payload?.error);
      const message =
        typeof failure?.message === "string"
          ? failure.message
          : "startup stage failed";
      // Keep the lifecycle state: the agent exits after a fatal stage and the
      // container observer marks the sandbox failed. Record the precise stage
      // error now so the failure surfaces with full context.
      await this.state.sandboxes.put({
        ...record,
        lastError: {
          code: "STARTUP_STAGE_FAILED",
          message: `${stage}: ${message}`,
        },
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if (record.lifecycleState === "daemon_connected") {
      await transitionSandboxLifecycle(
        this.lifecycleContext(),
        sandboxId,
        "booting",
        { observedState: "running", force: true },
      );
    }
  }
}

function findLastEvent(
  events: readonly StoredSandboxEvent[],
  predicate: (event: StoredSandboxEvent) => boolean,
): StoredSandboxEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event && predicate(event)) return event;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
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
