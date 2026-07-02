import type { SandboxConfigV1, SandboxOutboxRecord } from "@nervekit/shared";
import { SecretResolver } from "../credentials/secret-resolver.js";
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
  private reconnectAttempts = 0;
  private stopping = false;

  constructor(
    private readonly config: SandboxConfigV1,
    private readonly daemon: SandboxDaemon,
    private readonly stores: SandboxStateStores,
    private readonly instanceId: string,
    private readonly configDigest: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async start(): Promise<void> {
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.client?.send({
      type: "goodbye",
      reason: "shutdown",
      ts: new Date().toISOString(),
    });
    this.client?.close();
    this.state = "closed";
  }

  private async connect(): Promise<void> {
    this.state = this.reconnectAttempts > 0 ? "reconnecting" : "connecting";
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
      this.state = "connected";
      this.connectedAt = new Date().toISOString();
      this.reconnectAttempts = 0;
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
      this.startHeartbeat(
        Number(
          message.heartbeatIntervalMs ??
            this.config.controller.websocket.heartbeatIntervalMs ??
            15_000,
        ),
      );
      return;
    }
    if (message.type === "ack") {
      await this.stores.events.ack(
        String(message.stream),
        Number(message.processedSeq),
      );
      return;
    }
    if (message.type === "request") {
      try {
        const result = await this.daemon.router.dispatch(
          String(message.method),
          message.params,
        );
        this.client?.send({ type: "response", id: String(message.id), result });
        await this.flushUnacked();
      } catch (error) {
        this.client?.send({
          type: "error",
          id: String(message.id),
          error: {
            code: "COMMAND_FAILED",
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
    this.disconnectedAt = new Date().toISOString();
    this.state = "reconnecting";
    this.reconnectAttempts += 1;
    const policy = this.config.controller.disconnectPolicy;
    if (policy?.mode === "exit_self") {
      setTimeout(() => {
        if (this.state !== "connected") process.exit(22);
      }, policy.exitAfterMs ?? 60_000).unref();
    }
    const reconnect = this.config.controller.websocket.reconnect;
    const min = reconnect?.minDelayMs ?? 1_000;
    const max = reconnect?.maxDelayMs ?? 30_000;
    const delay = Math.min(max, min * 2 ** Math.min(this.reconnectAttempts, 6));
    setTimeout(() => void this.connect(), delay).unref();
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
