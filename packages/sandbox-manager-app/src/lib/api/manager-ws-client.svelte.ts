import { SvelteMap, SvelteSet, SvelteURL } from "svelte/reactivity";
import type {
  EventEnvelope,
  PeerDescriptor,
  StreamCursor,
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

const UI_CAPABILITIES = [
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "sandbox.manager.ui.v1",
  "sandbox.manager.snapshots.v1",
  "operation.sandbox.manager.recovery.get",
  "sandbox.manager.lifecycle.v1",
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
export type ManagerWsHandlers = {
  onEvent: (envelope: ManagerStreamEventEnvelope) => void | Promise<void>;
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
  private readonly cursors = new SvelteMap<string, number>();
  private selectedStream?: string;
  private closedByCaller = false;
  private wasReady = false;
  private generation = 0;

  constructor(
    private readonly handlers: ManagerWsHandlers,
    private readonly options: ManagerWsClientOptions = {},
  ) {
    this.restore();
    if (!this.cursors.has(MANAGER_STREAM)) this.cursors.set(MANAGER_STREAM, 0);
  }

  connect(): void {
    this.closedByCaller = false;
    const generation = ++this.generation;
    this.open(generation);
  }

  close(): void {
    this.closedByCaller = true;
    ++this.generation;
    void this.connection?.close().catch(() => undefined);
    this.connection = undefined;
    this.handlers.onConnectionChange("closed");
  }

  suspendSelection(): void {
    this.selectedStream = undefined;
    ++this.generation;
    const previous = this.connection;
    this.connection = undefined;
    void previous?.close().catch(() => undefined);
  }

  activateManager(cursors: readonly StreamCursor[] = []): void {
    this.selectedStream = undefined;
    if (cursors.length > 0) this.replaceCursors(cursors);
    const generation = ++this.generation;
    this.open(generation);
  }

  activateSelection(sandboxId: string, cursors: readonly StreamCursor[]): void {
    const stream = sandboxStreamId(sandboxId);
    this.selectedStream = stream;
    this.replaceCursors(cursors);
    if (!this.cursors.has(stream)) this.cursors.set(stream, 0);
    const generation = ++this.generation;
    const previous = this.connection;
    this.connection = undefined;
    if (previous) {
      void previous
        .close()
        .catch(() => undefined)
        .finally(() => {
          if (!this.closedByCaller && generation === this.generation)
            this.open(generation);
        });
    } else if (!this.closedByCaller) this.open(generation);
  }

  private open(generation: number): void {
    if (generation !== this.generation || this.closedByCaller) return;
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
        if (generation === this.generation) this.onConnectionState(state);
      },
      onError: (error) => {
        if (!this.closedByCaller && generation === this.generation)
          this.handlers.onConnectionChange("error", boundedError(error));
      },
      createSession: ({ send, onDisconnect }) =>
        new ProtocolClientSession({
          createMessage: messages,
          capabilities: UI_CAPABILITIES,
          requiredCapabilities: UI_CAPABILITIES,
          cursors: () => this.currentCursors(),
          send,
          onDisconnect,
          onReady: () => {
            if (generation !== this.generation) return;
            const reconnected = this.wasReady;
            this.wasReady = true;
            this.handlers.onConnectionChange("live");
            if (reconnected) this.handlers.onReconnected?.();
          },
          applyEvent: async (stream, event) => {
            if (generation !== this.generation)
              throw new Error("Stale manager UI protocol generation");
            if (stream.startsWith("sandbox:") && stream !== this.selectedStream)
              throw new Error(
                `Unexpected unselected sandbox stream: ${stream}`,
              );
            await this.handlers.onEvent({
              ...event,
              stream,
              sandboxId: streamSandboxId(stream),
            });
          },
          processedEvents: {
            persist: (cursors) => this.installCursors(cursors),
          },
          snapshotRecovery: {
            load: async ({ streams }) => {
              if (generation !== this.generation)
                throw new Error("Stale manager UI snapshot generation");
              const recovered =
                await this.handlers.onSnapshotRecovery?.(streams);
              if (generation !== this.generation)
                throw new Error("Stale manager UI snapshot generation");
              return {
                snapshot: undefined,
                cursors: recovered?.length ? recovered : this.currentCursors(),
                stateEpoch: STATE_EPOCH,
              };
            },
          },
          installSnapshot: (_snapshot, cursors) => {
            if (generation !== this.generation)
              throw new Error("Stale manager UI snapshot generation");
            this.replaceCursors(cursors);
          },
        }),
    });
    if (generation !== this.generation || this.closedByCaller) {
      void connection.close().catch(() => undefined);
      return;
    }
    this.connection = connection;
    void connection.start();
  }

  private currentCursors(): StreamCursor[] {
    const active = new SvelteSet([MANAGER_STREAM]);
    if (this.selectedStream) active.add(this.selectedStream);
    return [...active].map((stream) => ({
      stream,
      processedSeq: this.cursors.get(stream) ?? 0,
    }));
  }

  private installCursors(cursors: readonly StreamCursor[]): void {
    for (const cursor of cursors)
      this.cursors.set(
        cursor.stream,
        Math.max(this.cursors.get(cursor.stream) ?? 0, cursor.processedSeq),
      );
    this.persistCursors();
  }

  private replaceCursors(cursors: readonly StreamCursor[]): void {
    for (const cursor of cursors)
      this.cursors.set(cursor.stream, cursor.processedSeq);
    this.persistCursors();
  }

  private persistCursors(): void {
    try {
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
    } catch {
      /* Browser storage is optional. */
    }
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
        )
          this.cursors.set(cursor.stream, cursor.processedSeq);
      }
    } catch {
      try {
        this.storage().removeItem(STATE_KEY);
      } catch {
        /* optional */
      }
    }
  }

  private storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
    return this.options.storage ?? localStorage;
  }

  private onConnectionState(state: ProtocolClientConnectionState): void {
    if (state === "ready") return;
    if (state === "closed" && this.closedByCaller)
      this.handlers.onConnectionChange("closed");
    else if (state === "closed")
      this.handlers.onConnectionChange("reconnecting");
    else
      this.handlers.onConnectionChange(
        this.wasReady ? "reconnecting" : "connecting",
      );
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
function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
