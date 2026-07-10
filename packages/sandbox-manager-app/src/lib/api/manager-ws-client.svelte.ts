import type {
  EventEnvelope,
  SandboxManagerEventEnvelope,
} from "@nervekit/contracts";
import {
  eventBatchMessageSchema,
  nerveMessageSchema,
  replayStartedMessageSchema,
  replayUnavailableMessageSchema,
  welcomeMessageSchema,
} from "@nervekit/contracts";
import {
  applyEventBatch,
  type ClientEventStreamState,
  createClientEventStreamState,
  markProcessed,
} from "@nervekit/workbench-ui/core/protocol/event-stream";
import {
  protocolClientId,
  protocolInstanceId,
} from "@nervekit/workbench-ui/core/protocol/ids";

import { SvelteMap, SvelteSet } from "svelte/reactivity";

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
  "sandbox.manager.lifecycle.v1",
];

export const MANAGER_STREAM = "manager";

export function sandboxStreamId(sandboxId: string): string {
  return `sandbox:${sandboxId}`;
}

export type ManagerWsHandlers = {
  onEvent: (envelope: SandboxManagerEventEnvelope) => void;
  onConnectionChange: (state: ManagerWsConnectionState, error?: string) => void;
  onReconnected?: () => void;
  onReplayUnavailable?: (streams: string[]) => void;
};

export class ManagerWsClient {
  private ws: WebSocket | undefined;
  private readonly streams = new SvelteSet<string>([MANAGER_STREAM]);
  private readonly streamStates = new SvelteMap<
    string,
    ClientEventStreamState
  >();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private ackTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingAcks = new SvelteSet<string>();
  private readonly recoveredReplayStreams = new SvelteSet<string>();
  private closedByCaller = false;
  private hadWelcome = false;
  private sessionId: string | undefined;

  constructor(private readonly handlers: ManagerWsHandlers) {}

  connect(): void {
    this.closedByCaller = false;
    this.open();
  }

  close(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ws?.close(1000, "client_close");
    this.ws = undefined;
    this.handlers.onConnectionChange("closed");
  }

  subscribeStream(sandboxId: string): void {
    const stream = sandboxStreamId(sandboxId);
    if (this.streams.has(stream)) return;
    this.streams.add(stream);
    this.stateFor(stream);
    if (this.hadWelcome) this.requestReplay(stream);
  }

  private stateFor(stream: string): ClientEventStreamState {
    let state = this.streamStates.get(stream);
    if (!state) {
      state = createClientEventStreamState(0);
      this.streamStates.set(stream, state);
    }
    return state;
  }

  private wsUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/manager/ws`;
  }

  private open(): void {
    this.handlers.onConnectionChange(
      this.reconnectAttempts > 0 ? "reconnecting" : "connecting",
    );
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl());
    } catch (error) {
      this.scheduleReconnect(
        error instanceof Error ? error.message : "connect_failed",
      );
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => this.sendHello());
    ws.addEventListener("message", (event) => this.handleMessage(event.data));
    ws.addEventListener("close", () => this.handleClose());
    ws.addEventListener("error", () => {
      this.handlers.onConnectionChange("error", "socket_error");
    });
  }

  private sendHello(): void {
    this.sendMessage("hello", {
      role: "ui",
      client: {
        id: protocolClientId(),
        instanceId: protocolInstanceId(),
        name: "Nerve Sandbox Manager UI",
      },
      requestedVersion: 1,
      capabilities: UI_CAPABILITIES,
      encodings: ["json"],
      resume: {
        streams: [...this.streams].map((stream) => ({
          stream,
          processedSeq: this.stateFor(stream).processedSeq,
        })),
      },
      preferences: { replay: { preferSnapshot: true, maxReplayEvents: 1_000 } },
    });
  }

  private handleClose(): void {
    if (this.closedByCaller) return;
    this.scheduleReconnect("socket_closed");
  }

  private scheduleReconnect(error?: string): void {
    this.ws = undefined;
    this.hadWelcome = false;
    this.sessionId = undefined;
    if (this.closedByCaller) return;
    this.handlers.onConnectionChange("reconnecting", error);
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private handleMessage(raw: unknown): void {
    let decoded: unknown;
    try {
      decoded = JSON.parse(String(raw));
    } catch {
      return;
    }
    const parsed = nerveMessageSchema.safeParse(decoded);
    if (!parsed.success) return;
    const message = parsed.data;
    switch (message.kind) {
      case "welcome":
        this.onWelcome(message);
        return;
      case "event.batch":
        this.onEventBatch(message.data);
        return;
      case "heartbeat":
        this.sendHeartbeat();
        return;
      case "replay.started":
        this.onReplayStarted(message);
        return;
      case "replay.complete":
        return;
      case "replay.unavailable":
        this.onReplayUnavailable(message);
        return;
      case "goodbye":
        this.ws?.close(1000, "server_goodbye");
        return;
      case "error":
        this.handlers.onConnectionChange("error", "protocol_error");
        return;
      default:
        return;
    }
  }

  private onWelcome(message: unknown): void {
    const parsed = welcomeMessageSchema.safeParse(message);
    if (!parsed.success) return;
    const reconnected = this.reconnectAttempts > 0;
    this.reconnectAttempts = 0;
    this.hadWelcome = true;
    this.sessionId = parsed.data.data.sessionId;
    this.handlers.onConnectionChange("live");
    for (const stream of this.streams) this.requestReplay(stream);
    if (reconnected) this.handlers.onReconnected?.();
  }

  private onReplayStarted(message: unknown): void {
    const parsed = replayStartedMessageSchema.safeParse(message);
    if (!parsed.success) return;
    // A replay is the recovery path after a detected gap. Clear the blocked flag
    // and rewind continuity to the processed cursor so the incoming replay batch
    // (and subsequent live events) are applied instead of dropped.
    for (const stream of parsed.data.data.streams) {
      const state = this.stateFor(stream.stream);
      state.replayBlocked = false;
      state.continuitySeq = state.processedSeq;
    }
  }

  private onReplayUnavailable(message: unknown): void {
    const parsed = replayUnavailableMessageSchema.safeParse(message);
    if (!parsed.success) {
      this.handlers.onConnectionChange("error", "protocol_error");
      return;
    }
    const streams = parsed.data.data.streams.map((stream) => stream.stream);
    const unrecovered = streams.filter(
      (stream) => !this.recoveredReplayStreams.has(stream),
    );
    for (const stream of streams) this.recoveredReplayStreams.add(stream);
    if (unrecovered.length) this.handlers.onReplayUnavailable?.(unrecovered);
  }

  markSnapshotRecovered(stream: string): void {
    this.recoveredReplayStreams.add(stream);
  }

  private onEventBatch(data: unknown): void {
    const parsed = eventBatchMessageSchema.shape.data.safeParse(data);
    if (!parsed.success) return;
    const batch = parsed.data;
    const state = this.stateFor(batch.stream);
    const result = applyEventBatch(
      batch,
      state,
      (event) => this.deliverEvent(batch.stream, event),
      batch.stream,
    );
    if (result.replayRequired) {
      this.requestReplay(batch.stream, result.replayRequired.fromSeq);
      return;
    }
    if (result.durableEventsQueued > 0) {
      markProcessed(state, result.highestDurableQueuedSeq);
      this.queueAck(batch.stream);
    }
  }

  private deliverEvent(
    stream: string,
    event: EventEnvelope<Record<string, unknown>>,
  ): void {
    this.handlers.onEvent({
      stream,
      sandboxId: streamSandboxId(stream),
      seq: event.seq,
      id: event.id,
      ts: event.ts,
      type: event.type,
      durability: event.durability,
      data: event.data,
    });
  }

  private requestReplay(stream: string, fromSeq?: number): void {
    if (!this.sessionId) return;
    this.sendMessage("replay.request", {
      sessionId: this.sessionId,
      replayId: `replay_${Date.now()}`,
      streams: [
        { stream, fromSeq: fromSeq ?? this.stateFor(stream).processedSeq },
      ],
      reason: "resume",
      preferences: { maxEvents: 1_000, preferSnapshot: true },
    });
  }

  private sendHeartbeat(): void {
    if (!this.sessionId) return;
    this.sendMessage("heartbeat", {
      sessionId: this.sessionId,
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Timestamp is read immediately and is not reactive state.
      sentAt: new Date().toISOString(),
      processed: [...this.streamStates.entries()].map(([stream, state]) => ({
        stream,
        processedSeq: state.processedSeq,
      })),
    });
  }

  private queueAck(stream: string): void {
    this.pendingAcks.add(stream);
    if (this.ackTimer) return;
    this.ackTimer = setTimeout(() => this.flushAcks(), 250);
  }

  private flushAcks(): void {
    this.ackTimer = undefined;
    if (!this.sessionId || this.pendingAcks.size === 0) return;
    this.sendMessage("ack", {
      sessionId: this.sessionId,
      ackId: `ack_${Date.now()}`,
      streams: [...this.pendingAcks].map((stream) => ({
        stream,
        processedSeq: this.stateFor(stream).processedSeq,
      })),
    });
    this.pendingAcks.clear();
  }

  private sendMessage(kind: string, data: unknown): void {
    this.send({
      protocol: "nerve",
      version: 1,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      kind,
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Timestamp is read immediately and is not reactive state.
      ts: new Date().toISOString(),
      source: {
        role: "ui",
        id: protocolClientId(),
        instanceId: protocolInstanceId(),
        name: "Nerve Sandbox Manager UI",
      },
      target: { role: "orchestrator", id: "sandbox-manager" },
      data,
    });
  }

  private send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(message));
  }
}

function streamSandboxId(stream: string): string | undefined {
  return stream.startsWith("sandbox:")
    ? stream.slice("sandbox:".length)
    : undefined;
}
