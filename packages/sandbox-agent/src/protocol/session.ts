import {
  createLogger,
  type NerveMessage,
  type ProtocolV1Message,
  type SandboxConfigV1,
  type SandboxOutboxRecord,
  type StructuredLogger,
} from "@nervekit/contracts";
import { buildEventBatch, createMessageFactory } from "@nervekit/protocol";
import { SecretResolver } from "../credentials/secret-resolver.js";
import { SandboxCommandError } from "../daemon/errors.js";
import type { SandboxDaemon } from "../daemon/sandbox-daemon.js";
import type { SandboxRuntimeIdentity } from "../runtime/identity.js";
import type { SandboxStateStores } from "../state/sandbox-state.js";
import { SandboxWebSocketClient } from "./websocket-client.js";

export type ProtocolSessionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";
const REQUIRED_CAPABILITIES = [
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "sandbox.runtime.v1",
  "sandbox.commands.v1",
  "sandbox.events.v1",
  "sandbox.snapshots.v1",
] as const;

export function sandboxDaemonCapabilities(config: SandboxConfigV1): string[] {
  const capabilities = new Set<string>(REQUIRED_CAPABILITIES);
  capabilities.add("sandbox.models.pi_ai.v1");
  if (config.secretStores?.stores) capabilities.add("sandbox.secret_stores.v1");
  if (config.git?.enabled !== false) capabilities.add("sandbox.git_config.v1");
  if (config.github?.enabled) capabilities.add("sandbox.github_config.v1");
  if (config.tools?.groups) capabilities.add("sandbox.tool_groups.v1");
  if (config.tools?.groups?.web?.enabled)
    capabilities.add("sandbox.tools.web_search.v1");
  if (config.tools?.groups?.jira?.enabled)
    capabilities.add("sandbox.tools.jira.v1");
  if (config.tools?.groups?.confluence?.enabled)
    capabilities.add("sandbox.tools.confluence.v1");
  if (config.skills?.enabled !== false) capabilities.add("sandbox.skills.v1");
  if ((config.controller.disconnectPolicy?.mode ?? "exit_self") === "exit_self")
    capabilities.add("sandbox.disconnect_exit.v1");
  capabilities.add("sandbox.multi_agent_state.v1");
  if (config.security?.network)
    capabilities.add("sandbox.network.egress_policy.v1");
  return Array.from(capabilities).sort();
}

export class ProtocolSession {
  state: ProtocolSessionState = "disconnected";
  sessionId?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  private client?: SandboxWebSocketClient;
  private heartbeat?: NodeJS.Timeout;
  private heartbeatTimeout?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private reconnectScheduled = false;
  private pendingDisconnectReason:
    | "transport_closed"
    | "heartbeat_timeout"
    | "auth_failed"
    | "protocol_error"
    | "network_error"
    | "unknown" = "unknown";
  private readyStatus?: "ready" | "degraded";
  private acceptedCapabilities: string[] = [];
  private lastHeartbeatAt?: string;
  private stopping = false;
  private welcomeReceived = false;
  private welcomeWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer?: NodeJS.Timeout;
  }> = [];
  private flushScheduled = false;
  private unsubscribeOutbox?: () => void;
  private readonly logger: StructuredLogger;
  private readonly identity: SandboxRuntimeIdentity;

  constructor(
    private readonly config: SandboxConfigV1,
    private readonly daemon: SandboxDaemon,
    private readonly stores: SandboxStateStores,
    identity: SandboxRuntimeIdentity | string,
    private readonly configDigest: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    logger?: StructuredLogger,
  ) {
    this.identity =
      typeof identity === "string"
        ? { sandboxId: "unknown", instanceId: identity }
        : identity;
    this.logger =
      logger ??
      createLogger({
        level: config.observability?.logLevel ?? "info",
        base: {
          source: "sandbox-agent",
          component: "controller-session",
          sandboxId: this.identity.sandboxId,
          instanceId: this.identity.instanceId,
        },
      });
  }

  async start(): Promise<void> {
    this.unsubscribeOutbox ??= this.stores.events.subscribe((record) => {
      if (record.durability === "durable") this.scheduleFlush();
    });
    await this.connect();
  }

  async waitForWelcome(timeoutMs = 60_000): Promise<void> {
    if (this.welcomeReceived && this.state === "connected") return;
    await new Promise<void>((resolve, reject) => {
      const waiter: {
        resolve: () => void;
        reject: (error: Error) => void;
        timer?: NodeJS.Timeout;
      } = { resolve, reject };
      waiter.timer = setTimeout(() => {
        this.welcomeWaiters = this.welcomeWaiters.filter(
          (entry) => entry !== waiter,
        );
        reject(new Error("Timed out waiting for sandbox manager welcome"));
      }, timeoutMs);
      waiter.timer.unref();
      this.welcomeWaiters.push(waiter);
    });
  }

  async markReady(status: "ready" | "degraded" = "ready"): Promise<void> {
    this.readyStatus = status;
    await this.waitForWelcome();
    await this.announceReady(status);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.client?.send(
      this.message("goodbye", {
        sessionId: this.sessionId,
        reason: "client_closing",
      }),
    );
    this.unsubscribeOutbox?.();
    this.unsubscribeOutbox = undefined;
    this.client?.close();
    this.state = "closed";
    await this.persistConnectivity("shutting_down", {
      closeReason: "shutdown",
    });
  }

  private async connect(): Promise<void> {
    this.reconnectScheduled = false;
    this.state = this.reconnectAttempts > 0 ? "reconnecting" : "connecting";
    this.logger.info("controller connection attempt started", {
      reconnect: this.reconnectAttempts > 0,
      reconnectAttempts: this.reconnectAttempts,
      websocketUrl: safeWebSocketUrl(this.config.controller.websocket.url),
    });
    await this.persistConnectivity(this.state);
    const token = await new SecretResolver(
      this.config,
      undefined,
      this.env,
    ).resolve(this.config.controller.auth.apiKey);
    const header = this.config.controller.auth.header ?? "authorization";
    const scheme = this.config.controller.auth.scheme ?? "Bearer";
    const headers: Record<string, string> = {
      [header]: scheme ? `${scheme} ${token}` : token,
    };
    const client = new SandboxWebSocketClient(
      this.config.controller.websocket.url,
      {
        headers,
        connectTimeoutMs: this.config.controller.websocket.connectTimeoutMs,
      },
    );
    this.client = client;
    client.addEventListener("open", () => void this.onOpen(client));
    client.addEventListener(
      "message",
      (event) => void this.onMessage((event as CustomEvent).detail),
    );
    client.addEventListener("close", (event) => {
      const detail = (
        event as CustomEvent<{
          code?: number;
          reason?: string;
          closedByClient?: boolean;
        }>
      ).detail;
      void this.onDisconnect(client, detail);
    });
    client.addEventListener("error", (event) => {
      const error = (event as CustomEvent<unknown>).detail;
      this.pendingDisconnectReason = "network_error";
      this.logger.warn("controller connection error", {
        reconnectAttempts: this.reconnectAttempts,
        failure: safeError(error),
      });
    });
    client.connect();
  }

  private async onOpen(client: SandboxWebSocketClient): Promise<void> {
    this.logger.info("controller socket opened; sending hello", {
      reconnect: this.reconnectAttempts > 0,
      reconnectAttempts: this.reconnectAttempts,
    });
    const ack = await this.stores.events.ackState();
    client.send(
      this.message("hello", {
        requestedVersion: 1,
        capabilities: sandboxDaemonCapabilities(this.config),
        requiredCapabilities: [...REQUIRED_CAPABILITIES],
        encodings: ["json"],
        resume: { streams: ack.streams },
      }),
    );
  }

  private async onMessage(message: ProtocolV1Message): Promise<void> {
    if (message.kind === "welcome") {
      const accepted = new Set(message.data.capabilities);
      for (const capability of REQUIRED_CAPABILITIES) {
        if (!accepted.has(capability)) {
          throw new Error(
            `Required sandbox capability was not accepted: ${capability}`,
          );
        }
      }
      this.sessionId = message.data.sessionId;
      this.acceptedCapabilities = [...accepted].sort();
      this.state = "connected";
      this.connectedAt = new Date().toISOString();
      this.lastHeartbeatAt = this.connectedAt;
      const reconnectAttempts = this.reconnectAttempts;
      const wasReconnect = reconnectAttempts > 0;
      const disconnectedAt = this.disconnectedAt;
      const downtimeMs = disconnectedAt
        ? Math.max(0, Date.now() - Date.parse(disconnectedAt))
        : undefined;
      this.reconnectAttempts = 0;
      this.pendingDisconnectReason = "unknown";
      await this.persistConnectivity("connected");
      this.welcomeReceived = true;
      for (const waiter of this.welcomeWaiters.splice(0)) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.resolve();
      }
      if (wasReconnect) {
        await this.stores.events.append({
          type: "sandbox.controller.reconnected",
          durability: "durable",
          data: {
            ...this.identity,
            configDigest: this.configDigest,
            disconnectedAt,
            reconnectedAt: this.connectedAt,
            downtimeMs,
            reconnectAttempts,
            sessionId: this.sessionId,
            replayRequired: true,
          },
        });
      }
      await this.flushUnacked();
      if (wasReconnect && this.readyStatus)
        await this.announceReady(this.readyStatus);
      this.startHeartbeat(message.data.heartbeat.intervalMs);
      this.startHeartbeatTimeout(message.data.heartbeat.timeoutMs);
      return;
    }
    if (message.kind === "heartbeat") {
      this.lastHeartbeatAt = new Date().toISOString();
      await this.persistConnectivity(
        this.state === "connected" ? "connected" : "reconnecting",
      );
      return;
    }
    if (message.kind === "event.ack") {
      this.lastHeartbeatAt = new Date().toISOString();
      for (const cursor of message.data.streams) {
        if (cursor.stream === `sandbox:${this.identity.sandboxId}`) {
          await this.stores.events.ack(cursor.stream, cursor.processedSeq);
        }
      }
      await this.persistConnectivity(
        this.state === "connected" ? "connected" : "reconnecting",
      );
      return;
    }
    if (message.kind === "request") {
      const startedAt = Date.now();
      try {
        const result = await this.daemon.router.dispatch(
          message.data.method,
          message.data.params,
        );
        this.client?.send(
          this.message(
            "response",
            { ok: true, method: message.data.method, result },
            { replyTo: message.id, correlationId: message.id },
          ),
        );
        this.logger.debug("operation completed", {
          method: message.data.method,
          requestId: message.id,
          durationMs: Date.now() - startedAt,
        });
        await this.flushUnacked();
      } catch (error) {
        const commandError =
          error instanceof SandboxCommandError ? error : undefined;
        this.client?.send(
          this.message(
            "error",
            {
              code: commandError
                ? "DOMAIN_VALIDATION_FAILED"
                : "INTERNAL_ERROR",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
            },
            { replyTo: message.id, correlationId: message.id },
          ),
        );
      }
      return;
    }
    if (message.kind === "goodbye") this.client?.close();
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (!this.sessionId) return;
      this.client?.send(
        this.message("heartbeat", {
          sessionId: this.sessionId,
          sentAt: new Date().toISOString(),
          processed: [],
        }),
      );
    }, intervalMs);
  }

  private startHeartbeatTimeout(timeoutMs: number): void {
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.heartbeatTimeout = setTimeout(() => {
      if (this.stopping || this.state !== "connected") return;
      const now = Date.now();
      const last = this.lastHeartbeatAt
        ? Date.parse(this.lastHeartbeatAt)
        : Date.parse(this.connectedAt ?? new Date().toISOString());
      if (now - last < timeoutMs) {
        this.startHeartbeatTimeout(timeoutMs - (now - last));
        return;
      }
      this.logger.warn("controller heartbeat timed out", {
        sessionId: this.sessionId,
        timeoutMs,
        lastHeartbeatAt: this.lastHeartbeatAt,
      });
      this.pendingDisconnectReason = "heartbeat_timeout";
      this.client?.close();
    }, timeoutMs);
    this.heartbeatTimeout.unref();
  }

  private async announceReady(status: "ready" | "degraded"): Promise<void> {
    const readyAt = new Date().toISOString();
    const cursors = (await this.stores.events.ackState()).streams;
    if (!this.sessionId) return;
    this.client?.send(
      this.message("ready", { sessionId: this.sessionId, streams: cursors }),
    );
    this.logger.info("controller readiness announced", {
      sessionId: this.sessionId,
      status,
      reconnect: Boolean(this.disconnectedAt),
    });
    await this.persistConnectivity("connected", { readyAt });
    await this.flushUnacked();
  }

  private message<TData>(
    kind: string,
    data: TData,
    options: { replyTo?: string; correlationId?: string } = {},
  ): NerveMessage<TData> {
    return createMessageFactory({
      source: {
        role: "sandbox_agent",
        id: this.identity.sandboxId,
        instanceId: this.identity.instanceId,
        name: "Nerve Sandbox Agent",
      },
      target: { role: "sandbox_manager", id: "sandbox-manager" },
    })(kind, data, options);
  }

  private async persistConnectivity(
    state:
      | "connecting"
      | "connected"
      | "reconnecting"
      | "disconnected"
      | "shutting_down",
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.stores.connectivity.write({
      state,
      sessionId: this.sessionId,
      acceptedCapabilities: this.acceptedCapabilities.length
        ? this.acceptedCapabilities
        : undefined,
      connectedAt: this.connectedAt,
      disconnectedAt: this.disconnectedAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      reconnectAttempts: this.reconnectAttempts,
      updatedAt: new Date().toISOString(),
      ...extra,
    });
  }

  private scheduleFlush(): void {
    if (this.flushScheduled || this.state !== "connected") return;
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      void this.flushUnacked().catch((error) =>
        this.logger.warn("failed to flush startup events", { err: error }),
      );
    }, 100).unref();
  }

  private async flushUnacked(): Promise<void> {
    const ack = await this.stores.events.ackState();
    const processedSeq = Math.max(
      0,
      ...ack.streams.map((stream) => stream.processedSeq),
    );
    const unacked = this.stores.events.unacked(processedSeq);
    if (unacked.length === 0) return;
    for (let i = 0; i < unacked.length; i += 100) {
      const batch = unacked.slice(i, i + 100);
      const data = buildEventBatch(batch.map(toProtocolEvent), {
        stream: `sandbox:${this.identity.sandboxId}`,
        reason: "live",
        previousDurableSeq: processedSeq,
      });
      this.client?.send(this.message("event.batch", data));
    }
  }

  private async onDisconnect(
    client: SandboxWebSocketClient,
    detail: { code?: number; reason?: string; closedByClient?: boolean } = {},
  ): Promise<void> {
    if (client !== this.client || this.stopping || this.state === "closed")
      return;
    if (this.reconnectScheduled) return;
    this.reconnectScheduled = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.disconnectedAt = new Date().toISOString();
    this.state = "reconnecting";
    this.reconnectAttempts += 1;
    const reconnectDelay = this.reconnectDelayMs();
    const reason = disconnectReason(
      this.pendingDisconnectReason,
      detail.code,
      detail.reason,
    );
    const policy = this.config.controller.disconnectPolicy;
    const exits = (policy?.mode ?? "exit_self") === "exit_self";
    const exitAfterMs = exits ? (policy?.exitAfterMs ?? 300_000) : undefined;
    const exitAt =
      exitAfterMs === undefined
        ? undefined
        : new Date(Date.now() + exitAfterMs).toISOString();
    this.logger.warn("controller connection lost; reconnecting", {
      sessionId: this.sessionId,
      reason,
      closeCode: detail.code,
      closeReason: detail.reason?.trim() || undefined,
      reconnectAttempts: this.reconnectAttempts,
      reconnectDelayMs: reconnectDelay,
      exitAt,
    });
    await this.persistConnectivity("reconnecting", {
      closeCode: detail.code,
      closeReason: detail.reason?.trim() || undefined,
      lastErrorCode: reason.toUpperCase(),
      exitAfterMs,
      exitAt,
    });
    await this.stores.events.append({
      type: "sandbox.controller.disconnected",
      durability: "durable",
      data: {
        ...this.identity,
        configDigest: this.configDigest,
        disconnectedAt: this.disconnectedAt,
        reason,
        retryable: true,
        reconnectAttempts: this.reconnectAttempts,
        closeCode: detail.code,
        closeReason: detail.reason?.trim() || undefined,
        exitAfterMs,
        exitAt,
      },
    });
    if (exitAfterMs !== undefined) {
      setTimeout(() => {
        if (this.state !== "connected") process.exit(22);
      }, exitAfterMs).unref();
    }
    setTimeout(() => void this.connect(), reconnectDelay).unref();
  }

  private reconnectDelayMs(): number {
    const reconnect = this.config.controller.websocket.reconnect;
    const min = reconnect?.minDelayMs ?? 1_000;
    const max = reconnect?.maxDelayMs ?? 30_000;
    return Math.min(max, min * 2 ** Math.min(this.reconnectAttempts, 6));
  }
}

function safeWebSocketUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid websocket URL]";
  }
}

function safeError(error: unknown): { name?: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
}

function disconnectReason(
  pending:
    | "transport_closed"
    | "heartbeat_timeout"
    | "auth_failed"
    | "protocol_error"
    | "network_error"
    | "unknown",
  closeCode?: number,
  closeReason?: string,
):
  | "transport_closed"
  | "heartbeat_timeout"
  | "auth_failed"
  | "protocol_error"
  | "network_error"
  | "unknown" {
  if (pending !== "unknown") return pending;
  const text = closeReason?.toLowerCase() ?? "";
  if (closeCode === 1008 || /auth|unauthor|forbidden/.test(text))
    return "auth_failed";
  if (/protocol|invalid|capabilit/.test(text)) return "protocol_error";
  if (/timeout/.test(text)) return "network_error";
  return closeCode === undefined ? "unknown" : "transport_closed";
}

function toProtocolEvent(record: SandboxOutboxRecord) {
  return {
    id: record.id,
    seq: record.seq,
    ts: record.ts,
    type: record.type,
    durability: record.durability,
    data: record.data,
  };
}
