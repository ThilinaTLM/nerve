import {
  allOperationDefinitions,
  createLogger,
  operationNameSchema,
  type NerveMessage,
  type OperationName,
  type ProtocolErrorData,
  type ProtocolRequestData,
  type SandboxConfigV1,
  type SandboxOutboxRecord,
  type StructuredLogger,
} from "@nervekit/contracts";
import {
  buildEventBatch,
  createMessageFactory,
  nodeWebSocketTransportFactory,
  ProtocolClientConnection,
  ProtocolClientSession,
  RpcDispatcher,
  type OperationHandlerRegistry,
  type ProtocolClientConnectionState,
  ReconnectPolicy,
  type WebSocketLike,
} from "@nervekit/protocol";
import WebSocket from "ws";
import { SecretResolver } from "../credentials/secret-resolver.js";
import { SandboxOperationError } from "../daemon/errors.js";
import type { SandboxDaemon } from "../daemon/sandbox-daemon.js";
import type { SandboxRuntimeIdentity } from "../runtime/identity.js";
import type { SandboxStateStores } from "../state/sandbox-state.js";

export type SandboxProtocolClientState =
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
  return [...capabilities].sort();
}

export class SandboxProtocolClient {
  state: SandboxProtocolClientState = "disconnected";
  sessionId?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  private connection?: ProtocolClientConnection;
  private activeSession?: ProtocolClientSession;
  private readyStatus?: "ready" | "degraded";
  private stopping = false;
  private welcomed = false;
  private flushScheduled = false;
  private unsubscribeOutbox?: () => void;
  private reconnectAttempts = 0;
  private outageGeneration = 0;
  private outageActive = false;
  private exitTimer?: NodeJS.Timeout;
  private readonly transientQueue: SandboxOutboxRecord[] = [];
  private resumeCursors: Array<{ stream: string; processedSeq: number }> = [];
  private acceptedCapabilities: string[] = [];
  private readonly logger: StructuredLogger;
  private readonly identity: SandboxRuntimeIdentity;
  private readonly rpcDispatcher: RpcDispatcher;

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
    this.rpcDispatcher = new RpcDispatcher({
      handlers: sandboxOperationHandlers(daemon),
      idempotency: stores.idempotency,
      acceptedCapabilities: () => this.acceptedCapabilities,
      translateError: operationError,
    });
    this.logger =
      logger ??
      createLogger({
        level: config.observability?.logLevel ?? "info",
        base: {
          source: "sandbox-agent",
          component: "controller-session",
          ...this.identity,
        },
      });
  }

  async start(): Promise<void> {
    this.resumeCursors = [...(await this.stores.events.ackState()).streams];
    this.unsubscribeOutbox ??= this.stores.events.subscribe((record) => {
      if (record.durability === "transient") {
        if (this.transientQueue.length >= 256) this.transientQueue.shift();
        this.transientQueue.push(record);
      }
      this.scheduleFlush();
    });
    const token = await new SecretResolver(
      this.config,
      undefined,
      this.env,
    ).resolve(this.config.controller.auth.apiKey);
    const header = this.config.controller.auth.header ?? "authorization";
    const scheme = this.config.controller.auth.scheme ?? "Bearer";
    const headers = { [header]: scheme ? `${scheme} ${token}` : token };
    const messages = createMessageFactory({
      source: {
        role: "sandbox_agent",
        id: this.identity.sandboxId,
        instanceId: this.identity.instanceId,
        name: "Nerve Sandbox Agent",
      },
      target: { role: "sandbox_manager", id: "sandbox-manager" },
    });
    this.connection = new ProtocolClientConnection({
      transport: nodeWebSocketTransportFactory(
        () =>
          new WebSocket(this.config.controller.websocket.url, {
            headers,
            handshakeTimeout: this.config.controller.websocket.connectTimeoutMs,
          }) as unknown as WebSocketLike,
      ),
      reconnect: new ReconnectPolicy({
        initialDelayMs: this.config.controller.websocket.reconnect?.minDelayMs,
        maximumDelayMs: this.config.controller.websocket.reconnect?.maxDelayMs,
        multiplier: this.config.controller.websocket.reconnect?.multiplier,
        jitter: this.config.controller.websocket.reconnect?.jitter ? 0.2 : 0,
      }),
      onStateChange: (state) => void this.onConnectionState(state),
      onError: (error) =>
        this.logger.warn("controller protocol error", {
          failure: safeError(error),
        }),
      createSession: ({ send, onDisconnect }) => {
        const session = new ProtocolClientSession({
          createMessage: messages,
          capabilities: sandboxDaemonCapabilities(this.config),
          requiredCapabilities: REQUIRED_CAPABILITIES,
          cursors: () => this.resumeCursors,
          send,
          onDisconnect,
          rpcDispatcher: this.rpcDispatcher,
          awaitReady: async (welcome) => {
            this.sessionId = welcome.sessionId;
            this.acceptedCapabilities = [...welcome.capabilities].sort();
            this.welcomed = true;
            while (!this.readyStatus && !this.stopping)
              await new Promise((resolve) => setTimeout(resolve, 25));
          },
          onReady: async () => {
            this.activeSession = session;
            this.connectedAt = new Date().toISOString();
            this.state = "connected";
            this.reconnectAttempts = 0;
            this.outageActive = false;
            ++this.outageGeneration;
            if (this.exitTimer) clearTimeout(this.exitTimer);
            this.exitTimer = undefined;
            await this.persistConnectivity("connected");
            await this.flushUnacked(true);
          },
          onAck: async (message) => {
            const expected = `sandbox:${this.identity.sandboxId}`;
            const cursor = message.data.streams.find(
              (item) => item.stream === expected,
            );
            if (cursor) {
              await this.stores.events.ack(expected, cursor.processedSeq);
              this.resumeCursors = [
                { stream: expected, processedSeq: cursor.processedSeq },
              ];
            }
            this.scheduleFlush();
          },
        });
        this.activeSession = session;
        return session;
      },
    });
    this.state = "connecting";
    await this.persistConnectivity("connecting");
    void this.connection.start();
  }

  async waitForWelcome(timeoutMs = 60_000): Promise<void> {
    const started = Date.now();
    while (!this.welcomed) {
      if (Date.now() - started >= timeoutMs)
        throw new Error("Timed out waiting for sandbox manager welcome");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async markReady(status: "ready" | "degraded" = "ready"): Promise<void> {
    this.readyStatus = status;
    await this.waitForWelcome();
    await this.persistConnectivity("connected", {
      readyAt: new Date().toISOString(),
      agentStatus: status,
    });
    await this.flushUnacked(false);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    ++this.outageGeneration;
    if (this.exitTimer) clearTimeout(this.exitTimer);
    this.exitTimer = undefined;
    this.unsubscribeOutbox?.();
    this.unsubscribeOutbox = undefined;
    await this.connection?.close();
    this.state = "closed";
    await this.persistConnectivity("shutting_down", {
      closeReason: "shutdown",
    });
  }

  private scheduleFlush(): void {
    if (this.flushScheduled || this.state !== "connected") return;
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      void this.flushUnacked(false).catch((error) =>
        this.logger.warn("failed to flush sandbox outbox", {
          failure: safeError(error),
        }),
      );
    }, 100).unref();
  }

  private async flushUnacked(replay: boolean): Promise<void> {
    const session = this.activeSession;
    if (!session || session.state !== "ready") return;
    const stream = `sandbox:${this.identity.sandboxId}`;
    const ack = await this.stores.events.ackState();
    const processedSeq =
      ack.streams.find((item) => item.stream === stream)?.processedSeq ?? 0;
    const unacked = this.stores.events.unacked(processedSeq);
    const durableBatches = chunkOutboxRecords(unacked, processedSeq);
    for (const { records: batch, previousDurableSeq } of durableBatches) {
      await session.publishEventBatch(
        buildEventBatch(batch.map(toProtocolEvent), {
          stream,
          reason: replay ? "replay" : "live",
          previousDurableSeq,
        }),
      );
    }
    const previousDurableSeq =
      durableBatches.at(-1)?.records.at(-1)?.seq ?? processedSeq;
    while (this.transientQueue.length > 0 && session.state === "ready") {
      const batch = this.transientQueue.splice(0, 100);
      await session.publishEventBatch(
        buildEventBatch(batch.map(toProtocolEvent), {
          stream,
          reason: "live",
          previousDurableSeq,
        }),
      );
    }
  }

  private async onConnectionState(
    value: ProtocolClientConnectionState,
  ): Promise<void> {
    if (value === "ready") return;
    if (value === "closed" && this.stopping) return;
    if (value === "connecting" || value === "handshaking") {
      this.state = this.welcomed ? "reconnecting" : "connecting";
      return;
    }
    if (value !== "closed" && value !== "reconnecting") return;
    if (this.outageActive) return;
    this.outageActive = true;
    this.transientQueue.length = 0;
    this.disconnectedAt = new Date().toISOString();
    this.state = "reconnecting";
    this.reconnectAttempts += 1;
    const generation = ++this.outageGeneration;
    await this.persistConnectivity("reconnecting");
    const policy = this.config.controller.disconnectPolicy;
    if ((policy?.mode ?? "exit_self") === "exit_self") {
      const exitAfterMs = policy?.exitAfterMs ?? 300_000;
      this.exitTimer = setTimeout(() => {
        if (
          generation === this.outageGeneration &&
          this.state === "reconnecting"
        )
          process.exit(22);
      }, exitAfterMs);
      this.exitTimer.unref();
    }
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
      reconnectAttempts: this.reconnectAttempts,
      updatedAt: new Date().toISOString(),
      ...extra,
    });
  }
}

export function chunkOutboxRecords(
  records: readonly SandboxOutboxRecord[],
  initialPreviousDurableSeq: number,
  size = 100,
): Array<{
  records: SandboxOutboxRecord[];
  previousDurableSeq: number;
}> {
  const batches: Array<{
    records: SandboxOutboxRecord[];
    previousDurableSeq: number;
  }> = [];
  let previousDurableSeq = initialPreviousDurableSeq;
  for (let index = 0; index < records.length; index += size) {
    const batch = records.slice(index, index + size);
    batches.push({ records: batch, previousDurableSeq });
    previousDurableSeq = batch.at(-1)?.seq ?? previousDurableSeq;
  }
  return batches;
}

function sandboxOperationHandlers(
  daemon: SandboxDaemon,
): Partial<OperationHandlerRegistry> {
  const methods = new Set<string>(
    allOperationDefinitions()
      .filter((definition) =>
        definition.allowedTargetRoles.includes("sandbox_agent"),
      )
      .map((definition) => definition.method),
  );
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string" || !methods.has(property))
          return undefined;
        const method = operationNameSchema.parse(property) as OperationName;
        return (params: unknown, request: NerveMessage<ProtocolRequestData>) =>
          daemon.router.dispatch(method, params, {
            idempotencyKey: request.data.idempotencyKey,
            requestId: request.id,
          });
      },
    },
  );
}
function operationError(error: unknown): ProtocolErrorData {
  const domain = error instanceof SandboxOperationError;
  return {
    code: domain ? "DOMAIN_VALIDATION_FAILED" : "INTERNAL_ERROR",
    message: safeError(error),
    retryable: false,
  };
}
function toProtocolEvent(record: SandboxOutboxRecord) {
  return {
    id: record.id,
    seq: record.seq,
    type: record.type,
    ts: record.ts,
    durability: record.durability,
    data: record.data,
  };
}
function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
