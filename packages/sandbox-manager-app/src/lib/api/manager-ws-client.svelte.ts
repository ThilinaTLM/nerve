import { SvelteMap, SvelteSet, SvelteURL } from "svelte/reactivity";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  allOperationDefinitions,
  type EventEnvelope,
  type NotifyEvent,
  type PeerDescriptor,
  type StreamCursor,
} from "@nervekit/contracts";
import {
  browserWebSocketTransportFactory,
  createMessageFactory,
  ProtocolClientConnection,
  ProtocolClientSession,
  protocolClientId,
  protocolInstanceId,
  type ProtocolClientConnectionState,
  type TransportFactory,
} from "@nervekit/protocol";

export type ManagerWsConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "error"
  | "closed";

const RPC_CAPABILITIES = allOperationDefinitions()
  .filter(
    (definition) =>
      definition.allowedTargetRoles.includes("sandbox_manager") ||
      definition.allowedTargetRoles.includes("sandbox_agent"),
  )
  .map((definition) => definition.requiredCapability)
  .filter((capability): capability is string => Boolean(capability));

const UI_CAPABILITIES = [
  "encoding.json",
  "event.batch",
  "event.notify",
  STREAM_SUBSCRIPTION_CAPABILITY,
  "sandbox.manager.ui.v1",
  "sandbox.manager.snapshots.v1",
  "operation.sandbox.manager.recovery.get",
  "sandbox.manager.lifecycle.v1",
  ...RPC_CAPABILITIES,
];
const STATE_KEY = "nerve.protocol.v1.sandbox-manager-ui";
const STATE_EPOCH = "protocol-v1";
export const MANAGER_STREAM = "manager";

export function sandboxStreamId(sandboxId: string): string {
  return `sandbox:${sandboxId}`;
}

export type ManagerStreamEventEnvelope = EventEnvelope<
  Record<string, unknown>
> & {
  stream: string;
  sandboxId?: string;
};

export type ManagerStreamNotifyEvent = NotifyEvent<Record<string, unknown>> & {
  stream: string;
  sandboxId?: string;
};

export type ManagerWsHandlers = {
  onEvent: (envelope: ManagerStreamEventEnvelope) => void | Promise<void>;
  onNotify?: (event: ManagerStreamNotifyEvent) => void | Promise<void>;
  onConnectionChange: (state: ManagerWsConnectionState, error?: string) => void;
  onReconnected?: () => void;
  onSnapshotRecovery?: (
    streams: readonly string[],
  ) => readonly StreamCursor[] | void | Promise<readonly StreamCursor[] | void>;
};

export type ManagerWsClientOptions = {
  transportFactory?: () => TransportFactory;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  source?: () => PeerDescriptor;
};

type PersistedProtocolState = {
  epoch: typeof STATE_EPOCH;
  cursors: StreamCursor[];
};

export class ManagerWsClient {
  private connection?: ProtocolClientConnection;
  private activeSession?: ProtocolClientSession;
  private readonly cursors = new SvelteMap<string, number>();
  private desiredStream?: string;
  private activeSelectedStream?: string;
  private closedByCaller = false;
  private wasReady = false;
  private connectionGeneration = 0;
  private subscriptionGeneration = 0;
  private snapshotRecovery?: {
    generation: number;
    streams: Set<string>;
    promise: Promise<void>;
  };

  constructor(
    private readonly handlers: ManagerWsHandlers,
    private readonly options: ManagerWsClientOptions = {},
  ) {
    this.restore();
    if (!this.cursors.has(MANAGER_STREAM)) this.cursors.set(MANAGER_STREAM, 0);
  }

  connect(): void {
    this.closedByCaller = false;
    if (this.connection) return;
    this.open(++this.connectionGeneration);
  }

  close(): void {
    this.closedByCaller = true;
    ++this.connectionGeneration;
    ++this.subscriptionGeneration;
    this.activeSession = undefined;
    void this.connection?.close().catch(() => undefined);
    this.connection = undefined;
    this.handlers.onConnectionChange("closed");
  }

  async setSelection(
    sandboxId: string | undefined,
    cursors: readonly StreamCursor[],
  ): Promise<void> {
    const generation = ++this.subscriptionGeneration;
    this.desiredStream = sandboxId ? sandboxStreamId(sandboxId) : undefined;
    this.replaceCursors(cursors);
    if (this.desiredStream && !this.cursors.has(this.desiredStream)) {
      this.cursors.set(this.desiredStream, 0);
    }
    const session = this.activeSession;
    if (!session || session.state !== "ready") return;
    await this.applyDesiredSubscriptions(session, generation);
  }

  private async applyDesiredSubscriptions(
    session: ProtocolClientSession,
    generation: number,
  ): Promise<void> {
    const desired = this.currentCursors();
    const response = await session.subscribe(desired);
    if (generation !== this.subscriptionGeneration) return;
    const snapshotStreams = response.streams
      .filter((stream) => stream.mode === "snapshot_required")
      .map((stream) => stream.stream);
    if (snapshotStreams.length > 0) {
      await this.recoverSnapshotStreams(session, snapshotStreams, generation);
    }
    this.activeSelectedStream = this.desiredStream;
  }

  private recoverSnapshotStreams(
    session: ProtocolClientSession,
    streams: readonly string[],
    generation: number,
  ): Promise<void> {
    if (this.snapshotRecovery?.generation === generation) {
      for (const stream of streams) this.snapshotRecovery.streams.add(stream);
      return this.snapshotRecovery.promise;
    }
    const pending = new SvelteSet(streams);
    const promise = Promise.resolve().then(async () => {
      const recovered = await this.handlers.onSnapshotRecovery?.([...pending]);
      if (generation !== this.subscriptionGeneration) return;
      if (recovered?.length) this.replaceCursors(recovered);
      const retry = await session.subscribe(this.currentCursors());
      const unresolved = retry.streams.filter(
        (stream) => stream.mode === "snapshot_required",
      );
      if (unresolved.length > 0) {
        throw new Error(
          `Snapshot recovery did not restore: ${unresolved.map((stream) => stream.stream).join(", ")}`,
        );
      }
    });
    this.snapshotRecovery = { generation, streams: pending, promise };
    void promise.finally(() => {
      if (this.snapshotRecovery?.promise === promise) {
        this.snapshotRecovery = undefined;
      }
    });
    return promise;
  }

  private open(generation: number): void {
    if (generation !== this.connectionGeneration || this.closedByCaller) return;
    const source: PeerDescriptor = this.options.source?.() ?? {
      role: "ui",
      id: protocolClientId(),
      instanceId: protocolInstanceId(),
      name: "Nerve Sandbox Manager UI",
    };
    const messages = createMessageFactory({
      source,
      target: { role: "sandbox_manager", id: "sandbox-manager" },
    });
    const connection = new ProtocolClientConnection({
      transport:
        this.options.transportFactory?.() ??
        browserWebSocketTransportFactory(this.wsUrl()),
      onStateChange: (state) => {
        if (generation === this.connectionGeneration) {
          this.onConnectionState(state);
        }
      },
      onError: (error) => {
        if (!this.closedByCaller && generation === this.connectionGeneration) {
          this.handlers.onConnectionChange("error", boundedError(error));
        }
      },
      createSession: ({ send, onDisconnect }) => {
        const session: ProtocolClientSession = new ProtocolClientSession({
          createMessage: messages,
          capabilities: UI_CAPABILITIES,
          requiredCapabilities: UI_CAPABILITIES,
          cursors: () => this.currentCursors(),
          send,
          onDisconnect,
          onReady: () => {
            if (generation !== this.connectionGeneration) return;
            this.activeSession = session;
            void Promise.resolve()
              .then(async () => {
                await this.applyDesiredSubscriptions(
                  session,
                  this.subscriptionGeneration,
                );
                if (generation !== this.connectionGeneration) return;
                const reconnected = this.wasReady;
                this.wasReady = true;
                this.handlers.onConnectionChange("live");
                if (reconnected) this.handlers.onReconnected?.();
              })
              .catch((error: unknown) => {
                if (generation === this.connectionGeneration) {
                  this.handlers.onConnectionChange(
                    "error",
                    boundedError(error),
                  );
                }
              });
          },
          onSnapshotRequired: async (stream): Promise<void> => {
            await this.recoverSnapshotStreams(
              session,
              [stream],
              this.subscriptionGeneration,
            );
          },
          applyEvent: async (stream, event) => {
            if (generation !== this.connectionGeneration) {
              throw new Error("Stale manager UI protocol generation");
            }
            if (
              stream.startsWith("sandbox:") &&
              stream !== this.activeSelectedStream
            ) {
              throw new Error(
                `Unexpected unsubscribed sandbox stream: ${stream}`,
              );
            }
            await this.handlers.onEvent({
              ...event,
              stream,
              sandboxId: streamSandboxId(stream),
            });
            this.installCursors([{ stream, processedSeq: event.seq }]);
          },
          onNotify: async (events) => {
            for (const event of events) {
              const sandboxId = eventSandboxId(event);
              if (
                sandboxId &&
                sandboxStreamId(sandboxId) !== this.activeSelectedStream
              ) {
                continue;
              }
              await this.handlers.onNotify?.({
                ...event,
                stream: sandboxId ? sandboxStreamId(sandboxId) : MANAGER_STREAM,
                sandboxId,
              } as ManagerStreamNotifyEvent);
            }
          },
        });
        this.activeSession = session;
        return session;
      },
    });
    if (generation !== this.connectionGeneration || this.closedByCaller) {
      void connection.close().catch(() => undefined);
      return;
    }
    this.connection = connection;
    void connection.start();
  }

  private currentCursors(): StreamCursor[] {
    const active = new SvelteSet([MANAGER_STREAM]);
    if (this.desiredStream) active.add(this.desiredStream);
    return [...active].map((stream) => ({
      stream,
      processedSeq: this.cursors.get(stream) ?? 0,
    }));
  }

  private installCursors(nextCursors: readonly StreamCursor[]): void {
    for (const cursor of nextCursors) {
      this.cursors.set(
        cursor.stream,
        Math.max(this.cursors.get(cursor.stream) ?? 0, cursor.processedSeq),
      );
    }
    this.persistCursors();
  }

  private replaceCursors(nextCursors: readonly StreamCursor[]): void {
    for (const cursor of nextCursors) {
      this.cursors.set(cursor.stream, cursor.processedSeq);
    }
    this.persistCursors();
  }

  private persistCursors(): void {
    this.storage().setItem(
      STATE_KEY,
      JSON.stringify({
        epoch: STATE_EPOCH,
        cursors: [...this.cursors].map(([stream, processedSeq]) => ({
          stream,
          processedSeq,
        })),
      } satisfies PersistedProtocolState),
    );
  }

  private restore(): void {
    try {
      const raw = this.storage().getItem(STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedProtocolState>;
      if (parsed.epoch !== STATE_EPOCH || !Array.isArray(parsed.cursors)) {
        this.storage().removeItem(STATE_KEY);
        return;
      }
      for (const cursor of parsed.cursors) {
        if (
          typeof cursor.stream === "string" &&
          Number.isSafeInteger(cursor.processedSeq) &&
          cursor.processedSeq >= 0
        ) {
          this.cursors.set(cursor.stream, cursor.processedSeq);
        }
      }
    } catch {
      try {
        this.storage().removeItem(STATE_KEY);
      } catch {
        // Storage is optional in tests and privacy-constrained browsers.
      }
    }
  }

  private storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
    return this.options.storage ?? localStorage;
  }

  private onConnectionState(state: ProtocolClientConnectionState): void {
    if (state === "ready") return;
    if (state === "closed") this.activeSession = undefined;
    if (state === "closed" && this.closedByCaller) {
      this.handlers.onConnectionChange("closed");
    } else if (state === "closed") {
      this.handlers.onConnectionChange("reconnecting");
    } else {
      this.handlers.onConnectionChange(
        this.wasReady ? "reconnecting" : "connecting",
      );
    }
  }

  private wsUrl(): URL {
    const url = new SvelteURL("/api/manager/ws", window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return url;
  }
}

function streamSandboxId(stream: string): string | undefined {
  return stream.startsWith("sandbox:")
    ? stream.slice("sandbox:".length)
    : undefined;
}

function eventSandboxId(event: NotifyEvent): string | undefined {
  if (!event.data || typeof event.data !== "object") return undefined;
  const sandboxId = (event.data as Record<string, unknown>).sandboxId;
  return typeof sandboxId === "string" ? sandboxId : undefined;
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
