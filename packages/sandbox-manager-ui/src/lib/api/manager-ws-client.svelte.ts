import {
  type SandboxManagerEventEnvelope,
  sandboxProtocolEventBatchSchema,
  sandboxProtocolReplayResponseSchema,
} from "@nervekit/shared";

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

type StreamCursor = { processedSeq: number; receivedSeq: number };

export type ManagerWsHandlers = {
  onEvent: (envelope: SandboxManagerEventEnvelope) => void;
  onConnectionChange: (state: ManagerWsConnectionState, error?: string) => void;
  onReconnected?: () => void;
};

/**
 * Same-origin manager UI WebSocket client. Speaks the sandbox protocol frame
 * format (`type`) rather than the orchestrator envelope, maintains per-stream
 * cursors, requests replay on connect/gap, and acks processed durable events.
 */
export class ManagerWsClient {
  private ws: WebSocket | undefined;
  private readonly streams = new Set<string>([MANAGER_STREAM]);
  private readonly cursors = new Map<string, StreamCursor>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private ackTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingAcks = new Set<string>();
  private closedByCaller = false;
  private hadWelcome = false;

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

  /** Track a sandbox stream so it is replayed on (re)connect. */
  subscribeStream(sandboxId: string): void {
    const stream = sandboxStreamId(sandboxId);
    if (this.streams.has(stream)) return;
    this.streams.add(stream);
    if (this.hadWelcome) this.requestReplay(stream);
  }

  private cursorFor(stream: string): StreamCursor {
    let cursor = this.cursors.get(stream);
    if (!cursor) {
      cursor = { processedSeq: 0, receivedSeq: 0 };
      this.cursors.set(stream, cursor);
    }
    return cursor;
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
    const cursors = [...this.streams].map((stream) => ({
      stream,
      processedSeq: this.cursorFor(stream).processedSeq,
    }));
    this.send({
      type: "hello",
      version: 1,
      role: "ui",
      capabilities: UI_CAPABILITIES,
      resume: { cursors },
    });
  }

  private handleClose(): void {
    if (this.closedByCaller) return;
    this.scheduleReconnect("socket_closed");
  }

  private scheduleReconnect(error?: string): void {
    this.ws = undefined;
    this.hadWelcome = false;
    if (this.closedByCaller) return;
    this.handlers.onConnectionChange("reconnecting", error);
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private handleMessage(raw: unknown): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (message.type) {
      case "welcome":
        this.onWelcome();
        return;
      case "event.batch":
        this.onEventBatch(message, false);
        return;
      case "replay.response":
        this.onReplayResponse(message);
        return;
      case "heartbeat":
        this.send({ type: "heartbeat", ts: new Date().toISOString() });
        return;
      case "goodbye":
        this.ws?.close(1000, "server_goodbye");
        return;
      default:
        return;
    }
  }

  private onWelcome(): void {
    const reconnected = this.reconnectAttempts > 0;
    this.reconnectAttempts = 0;
    this.hadWelcome = true;
    this.handlers.onConnectionChange("live");
    for (const stream of this.streams) this.requestReplay(stream);
    if (reconnected) this.handlers.onReconnected?.();
  }

  private onEventBatch(
    message: Record<string, unknown>,
    replay: boolean,
  ): void {
    const parsed = sandboxProtocolEventBatchSchema.safeParse(message);
    if (!parsed.success) return;
    const stream = parsed.data.stream;
    const cursor = this.cursorFor(stream);
    for (const event of parsed.data.events) {
      if (event.seq <= cursor.receivedSeq && !replay) continue;
      const durable = (event.durability ?? "durable") === "durable";
      if (
        !replay &&
        durable &&
        event.seq > cursor.processedSeq + 1 &&
        cursor.processedSeq > 0
      ) {
        this.requestReplay(stream, cursor.processedSeq);
      }
      cursor.receivedSeq = Math.max(cursor.receivedSeq, event.seq);
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
      if (durable && event.seq > cursor.processedSeq) {
        cursor.processedSeq = event.seq;
        this.queueAck(stream);
      }
    }
  }

  private onReplayResponse(message: Record<string, unknown>): void {
    const parsed = sandboxProtocolReplayResponseSchema.safeParse(message);
    if (!parsed.success) return;
    const stream = parsed.data.stream;
    const cursor = this.cursorFor(stream);
    for (const event of parsed.data.events) {
      if (event.seq <= cursor.processedSeq) continue;
      cursor.receivedSeq = Math.max(cursor.receivedSeq, event.seq);
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
      if ((event.durability ?? "durable") === "durable")
        cursor.processedSeq = event.seq;
    }
    this.queueAck(stream);
  }

  private requestReplay(stream: string, afterSeq?: number): void {
    this.send({
      type: "replay.request",
      stream,
      afterSeq: afterSeq ?? this.cursorFor(stream).processedSeq,
    });
  }

  private queueAck(stream: string): void {
    this.pendingAcks.add(stream);
    if (this.ackTimer) return;
    this.ackTimer = setTimeout(() => this.flushAcks(), 250);
  }

  private flushAcks(): void {
    this.ackTimer = undefined;
    for (const stream of this.pendingAcks) {
      this.send({
        type: "ack",
        stream,
        processedSeq: this.cursorFor(stream).processedSeq,
      });
    }
    this.pendingAcks.clear();
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
