import {
  createLogger,
  type SandboxConfigV1,
  type SandboxOutboxRecord,
  type StructuredLogger,
} from "@nervekit/shared";
import { SecretResolver } from "../credentials/secret-resolver.js";
import { SandboxCommandError } from "../daemon/errors.js";
import type { SandboxDaemon } from "../daemon/sandbox-daemon.js";
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
  private acceptedCapabilities: string[] = [];
  private lastHeartbeatAt?: string;
  private stopping = false;
  private readonly logger: StructuredLogger;

  constructor(
    private readonly config: SandboxConfigV1,
    private readonly daemon: SandboxDaemon,
    private readonly stores: SandboxStateStores,
    private readonly instanceId: string,
    private readonly configDigest: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    logger?: StructuredLogger,
  ) {
    this.logger =
      logger ??
      createLogger({
        level: config.observability?.logLevel ?? "info",
        base: {
          source: "sandbox-agent",
          component: "controller-session",
          sandboxId: config.identity?.sandboxId,
          instanceId,
        },
      });
  }

  async start(): Promise<void> {
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.client?.send({
      type: "goodbye",
      reason: "shutdown",
      ts: new Date().toISOString(),
    });
    this.client?.close();
    this.state = "closed";
    await this.persistConnectivity("shutting_down", {
      closeReason: "shutdown",
    });
  }

  private async connect(): Promise<void> {
    this.state = this.reconnectAttempts > 0 ? "reconnecting" : "connecting";
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
    client.addEventListener("close", () => void this.onDisconnect());
    client.addEventListener("error", () => undefined);
    client.connect();
  }

  private async onOpen(client: SandboxWebSocketClient): Promise<void> {
    const ack = await this.stores.events.ackState();
    const processedSeq = Math.max(
      0,
      ...ack.streams.map((stream) => stream.processedSeq),
    );
    client.send({
      type: "hello",
      version: 1,
      role: "agent",
      sandboxId: this.config.identity?.sandboxId ?? "unknown",
      instanceId: this.instanceId,
      capabilities: sandboxDaemonCapabilities(this.config),
      resume: { cursors: ack.streams, lastAckedSeq: processedSeq },
    });
  }

  private async onMessage(message: {
    type: string;
    [key: string]: unknown;
  }): Promise<void> {
    if (message.type === "welcome") {
      const accepted = Array.isArray(message.acceptedCapabilities)
        ? new Set(message.acceptedCapabilities.map(String))
        : new Set<string>();
      for (const capability of REQUIRED_CAPABILITIES) {
        if (!accepted.has(capability)) {
          throw new Error(
            `Required sandbox capability was not accepted: ${capability}`,
          );
        }
      }
      this.sessionId = String(message.sessionId);
      this.acceptedCapabilities = Array.from(accepted).sort();
      this.state = "connected";
      this.connectedAt = new Date().toISOString();
      this.lastHeartbeatAt = this.connectedAt;
      const wasReconnect = this.reconnectAttempts > 0;
      this.reconnectAttempts = 0;
      this.logger.info("controller session established", {
        sessionId: this.sessionId,
        reconnect: wasReconnect,
        daemonStatus: this.daemon.status.status,
      });
      await this.persistConnectivity("connected");
      this.daemon.start();
      this.client?.send({
        type: "ready",
        sandboxId: this.config.identity?.sandboxId,
        instanceId: this.instanceId,
        status: this.daemon.status.status === "degraded" ? "degraded" : "ready",
        cursors: (await this.stores.events.ackState()).streams,
      });
      await this.emitStartupEvent();
      await this.flushUnacked();
      const heartbeatIntervalMs = Number(
        message.heartbeatIntervalMs ??
          this.config.controller.websocket.heartbeatIntervalMs ??
          15_000,
      );
      this.startHeartbeat(heartbeatIntervalMs);
      this.startHeartbeatTimeout(
        Number(message.heartbeatTimeoutMs ?? heartbeatIntervalMs * 3),
      );
      return;
    }
    if (message.type === "heartbeat") {
      this.lastHeartbeatAt = new Date().toISOString();
      await this.persistConnectivity(
        this.state === "connected" ? "connected" : "reconnecting",
      );
      return;
    }
    if (message.type === "ack") {
      this.lastHeartbeatAt = new Date().toISOString();
      await this.stores.events.ack(
        String(message.stream),
        Number(message.processedSeq),
      );
      await this.persistConnectivity(
        this.state === "connected" ? "connected" : "reconnecting",
      );
      return;
    }
    if (message.type === "request") {
      const method = String(message.method);
      const requestId = String(message.id);
      const startedAt = Date.now();
      this.logger.debug("command received", { method, requestId });
      try {
        const result = await this.daemon.router.dispatch(
          method,
          message.params,
        );
        this.client?.send({ type: "response", id: requestId, result });
        this.logger.debug("command completed", {
          method,
          requestId,
          durationMs: Date.now() - startedAt,
        });
        await this.flushUnacked();
      } catch (error) {
        this.logger.error("command failed", {
          method,
          requestId,
          durationMs: Date.now() - startedAt,
          err: error,
        });
        const commandError =
          error instanceof SandboxCommandError ? error : undefined;
        this.client?.send({
          type: "error",
          id: requestId,
          error: {
            code: commandError?.code ?? "COMMAND_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  private async emitStartupEvent(): Promise<void> {
    await this.stores.events.append({
      type: "sandbox.ready",
      durability: "durable",
      data: {
        sandboxId: this.config.identity?.sandboxId,
        instanceId: this.instanceId,
        configDigest: this.configDigest,
        status: "ready",
        readyAt: new Date().toISOString(),
        recovered: false,
        daemonStatus: this.daemon.status.status,
        cursor: { streams: (await this.stores.events.ackState()).streams },
      },
    });
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      this.client?.send({
        type: "heartbeat",
        ts: new Date().toISOString(),
        status: this.daemon.status.status,
      });
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
      this.client?.close();
      this.state = "reconnecting";
      this.disconnectedAt = new Date().toISOString();
      void this.persistConnectivity("reconnecting", {
        lastErrorCode: "HEARTBEAT_TIMEOUT",
        closeReason: "manager heartbeat timeout",
      });
    }, timeoutMs);
    this.heartbeatTimeout.unref();
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
      this.client?.send({
        type: "event.batch",
        batchId: `batch_${Date.now()}_${i}`,
        stream: "sandbox",
        firstSeq: batch[0]?.seq,
        lastSeq: batch.at(-1)?.seq,
        events: batch.map(toProtocolEvent),
      });
    }
  }

  private async onDisconnect(): Promise<void> {
    if (this.stopping || this.state === "closed") return;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.disconnectedAt = new Date().toISOString();
    this.state = "reconnecting";
    this.reconnectAttempts += 1;
    const reconnectDelay = this.reconnectDelayMs();
    this.logger.warn("controller connection lost; reconnecting", {
      sessionId: this.sessionId,
      reconnectAttempts: this.reconnectAttempts,
      reconnectDelayMs: reconnectDelay,
    });
    await this.persistConnectivity("reconnecting");
    const policy = this.config.controller.disconnectPolicy;
    if (policy?.mode === "exit_self") {
      setTimeout(() => {
        if (this.state !== "connected") process.exit(22);
      }, policy.exitAfterMs ?? 60_000).unref();
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
