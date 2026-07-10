/* eslint-disable max-lines -- ProtocolSession coordinates the websocket protocol state machine. */
import {
  type AckData,
  ackMessageSchema,
  createId,
  type EventEnvelope,
  eventBatchMessageSchema,
  type FlowMode,
  flowUpdateMessageSchema,
  goodbyeMessageSchema,
  type HelloData,
  heartbeatMessageSchema,
  helloMessageSchema,
  type NerveErrorCode,
  type NerveMessage,
  nerveMessageSchema,
  type ProtocolErrorData,
  protocolErrorMessageSchema,
  type ReplayRequestData,
  readyMessageSchema,
  replayRequestMessageSchema,
  type StreamCursor,
  type WelcomeData,
} from "@nervekit/contracts";
import WebSocket from "ws";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { version } from "../app/version.js";
import {
  GLOBAL_STREAM,
  PROTOCOL_CAPABILITIES,
  PROTOCOL_HEARTBEAT,
  PROTOCOL_LIMITS,
  REQUIRED_PROTOCOL_CAPABILITIES,
} from "./constants.js";
import { buildEventBatch, chunkEvents } from "./event-batch.js";
import { decideFlow } from "./flow-control.js";
import { createProtocolMessage, orchestratorSource } from "./messages.js";
import { protocolErrorData } from "./protocol-errors.js";
import { planReplay, replayUnavailableData } from "./replay-coordinator.js";
import { ProtocolSessionQueue } from "./session-queue.js";

const MAX_HANDSHAKE_MS = 10_000;

type SessionPhase =
  | "awaiting_hello"
  | "established"
  | "live"
  | "replaying"
  | "snapshot_required"
  | "closed";

export class ProtocolSession {
  readonly sessionId = createId("ses");
  #phase: SessionPhase = "awaiting_hello";
  #clientMessageCount = 0;
  #capabilities: string[] = [];
  #processedSeq = 0;
  #highestReceivedSeq = 0;
  #lastDeliveredDurableSeq = 0;
  #lastAckedSeq = 0;
  #replayFromSeq: number | undefined;
  #pendingLive: EventEnvelope[] = [];
  #queue = new ProtocolSessionQueue();
  #flushTimer?: NodeJS.Timeout;
  #malformedStrikes = 0;
  #rateWindowStartedAt = Date.now();
  #rateWindowMessages = 0;
  #unsubscribe?: () => void;
  #handshakeTimer?: NodeJS.Timeout;
  #heartbeatTimer?: NodeJS.Timeout;
  #flowMode: FlowMode = "normal";

  constructor(
    private readonly ws: WebSocket,
    private readonly state: OrchestratorState,
  ) {}

  start(): void {
    this.#handshakeTimer = setTimeout(() => {
      this.sendError("SESSION_REJECTED", "Protocol hello timed out", {
        close: true,
      });
      this.close(1002, "Protocol hello timed out");
    }, MAX_HANDSHAKE_MS);
    this.#handshakeTimer.unref();
    this.ws.on("message", (data) => this.handleRawMessage(data));
    this.ws.on("close", () => this.dispose());
    this.ws.on("error", () => this.dispose());
  }

  shutdown(reason = "Daemon shutting down"): void {
    if (this.#phase === "closed") return;
    this.send("goodbye", {
      sessionId: this.sessionId,
      reason: "server_shutdown",
      message: reason,
      finalCursors: [
        { stream: GLOBAL_STREAM, processedSeq: this.#lastAckedSeq },
      ],
    });
    this.close(1001, reason);
  }

  private handleRawMessage(data: WebSocket.RawData): void {
    if (this.#phase === "closed") return;
    const text = data.toString();
    if (Buffer.byteLength(text, "utf8") > PROTOCOL_LIMITS.maxMessageBytes) {
      this.sendError("MESSAGE_TOO_LARGE", "Protocol message is too large", {
        close: true,
      });
      this.close(1009, "Message too large");
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.recordMalformed("INVALID_JSON", "Frame was not valid JSON");
      return;
    }

    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      this.recordMalformed(
        "INVALID_MESSAGE",
        "Protocol frame must be an object",
      );
      return;
    }

    const rawEnvelope = raw as Record<string, unknown>;
    if (rawEnvelope.protocol !== "nerve") {
      this.recordMalformed("INVALID_MESSAGE", "Unsupported protocol");
      return;
    }
    if (rawEnvelope.version !== 1) {
      this.recordMalformed(
        "PROTOCOL_VERSION_UNSUPPORTED",
        "Unsupported protocol version",
      );
      return;
    }

    const envelope = nerveMessageSchema.safeParse(raw);
    if (!envelope.success) {
      this.recordMalformed("INVALID_MESSAGE", "Protocol envelope is invalid");
      return;
    }

    const message = envelope.data as NerveMessage;
    if (this.rateLimited(message.id)) return;
    this.#clientMessageCount += 1;
    if (this.#clientMessageCount === 1 && message.kind !== "hello") {
      this.sendError(
        "SESSION_REJECTED",
        "First protocol message must be hello",
        {
          replyTo: message.id,
          close: true,
        },
      );
      this.close(1002, "Expected hello");
      return;
    }

    void this.handleMessage(message).catch((error) => {
      void this.state.logger.warn("Protocol message handling failed", {
        error,
        context: { sessionId: this.sessionId, kind: message.kind },
      });
      this.sendError("INTERNAL_ERROR", "Protocol handler failed", {
        replyTo: message.id,
        retryable: true,
      });
    });
  }

  private recordMalformed(code: NerveErrorCode, message: string): void {
    this.#malformedStrikes += 1;
    const close =
      this.#phase === "awaiting_hello" ||
      this.#malformedStrikes >= PROTOCOL_LIMITS.malformedMessageStrikes;
    this.sendError(code, message, { close });
    if (close) this.close(1002, message);
  }

  private rateLimited(replyTo?: string): boolean {
    const now = Date.now();
    if (
      now - this.#rateWindowStartedAt >
      PROTOCOL_LIMITS.clientMessageWindowMs
    ) {
      this.#rateWindowStartedAt = now;
      this.#rateWindowMessages = 0;
    }
    this.#rateWindowMessages += 1;
    if (this.#rateWindowMessages <= PROTOCOL_LIMITS.clientMessagesPerWindow) {
      return false;
    }
    this.sendError("RATE_LIMITED", "Too many protocol messages", {
      replyTo,
      retryable: true,
      details: { retryAfterMs: PROTOCOL_LIMITS.clientMessageWindowMs },
    });
    return true;
  }

  private async handleMessage(message: NerveMessage): Promise<void> {
    switch (message.kind) {
      case "hello":
        this.handleHello(message);
        break;
      case "ready":
        await this.handleReady(message);
        break;
      case "ack":
        this.handleAck(message);
        break;
      case "replay.request":
        await this.handleReplayRequest(message);
        break;
      case "heartbeat":
        heartbeatMessageSchema.parse(message);
        break;
      case "goodbye":
        goodbyeMessageSchema.parse(message);
        this.close(1000, "Client closing");
        break;
      case "flow.update":
        flowUpdateMessageSchema.parse(message);
        break;
      default:
        this.sendError(
          "UNKNOWN_MESSAGE_KIND",
          `Unknown protocol kind: ${message.kind}`,
          {
            replyTo: message.id,
          },
        );
    }
  }

  private handleHello(message: NerveMessage): void {
    if (this.#phase !== "awaiting_hello") {
      this.sendError(
        "SESSION_REJECTED",
        "hello is only valid as the first message",
        {
          replyTo: message.id,
          close: true,
        },
      );
      this.close(1002, "Unexpected hello");
      return;
    }
    const parsed = helloMessageSchema.safeParse(message);
    if (!parsed.success) {
      this.sendError("INVALID_MESSAGE", "hello payload is invalid", {
        replyTo: message.id,
        close: true,
      });
      this.close(1002, "Invalid hello");
      return;
    }
    const hello = parsed.data.data;
    const missing = REQUIRED_PROTOCOL_CAPABILITIES.filter(
      (capability) => !hello.capabilities.includes(capability),
    );
    if (missing.length > 0 || !hello.encodings.includes("json")) {
      this.sendError(
        "CAPABILITY_REQUIRED",
        "Required protocol capabilities are missing",
        {
          replyTo: message.id,
          details: { missing },
          close: true,
        },
      );
      this.close(1002, "Capability required");
      return;
    }

    clearTimeout(this.#handshakeTimer);
    this.#capabilities = PROTOCOL_CAPABILITIES.filter((capability) =>
      hello.capabilities.includes(capability),
    );
    this.#processedSeq = resumeCursor(hello);
    this.#lastDeliveredDurableSeq = this.#processedSeq;
    this.#lastAckedSeq = this.#processedSeq;
    this.#replayFromSeq = undefined;

    const latestSeq = this.state.events.latestSeq;
    const latestDurableSeq = this.state.events.latestDurableSeq;
    const bufferedFloor = this.state.events.bufferedFloorSeq();
    const cursorProvided = hello.resume !== undefined;
    let mode: WelcomeData["resume"]["mode"];
    let reason: string | undefined;

    if (cursorProvided && this.#processedSeq > latestDurableSeq) {
      mode = "snapshot_required";
      reason = "Client cursor is ahead of server durable cursor";
      this.#phase = "snapshot_required";
    } else if (cursorProvided && this.#processedSeq < latestDurableSeq) {
      mode = "replay";
      reason = "Client cursor is behind latest durable sequence";
      this.#replayFromSeq = this.#processedSeq;
      this.#phase = "established";
    } else if (cursorProvided) {
      mode = "live";
      this.#phase = "established";
    } else {
      mode = "fresh";
      this.#phase = "established";
    }

    this.#unsubscribe = this.state.events.subscribe((event) =>
      this.handleLiveEvent(event),
    );

    this.send(
      "welcome",
      {
        sessionId: this.sessionId,
        orchestrator: {
          id: this.state.daemonId,
          version,
          startedAt: this.state.startedAt,
        },
        acceptedVersion: 1,
        capabilities: this.#capabilities,
        encoding: "json",
        streams: [
          {
            stream: GLOBAL_STREAM,
            latestSeq,
            durableSeq: latestDurableSeq,
            replayFromSeq: this.#replayFromSeq,
            replayAvailableFromSeq: bufferedFloor === 0 ? 0 : bufferedFloor - 1,
          },
        ],
        limits: PROTOCOL_LIMITS,
        heartbeat: PROTOCOL_HEARTBEAT,
        resume: {
          accepted: mode !== "snapshot_required",
          mode,
          reason,
        },
      },
      { replyTo: message.id, correlationId: message.id },
    );

    this.startHeartbeat();
  }

  private async handleReady(message: NerveMessage): Promise<void> {
    const parsed = readyMessageSchema.safeParse(message);
    if (!parsed.success || parsed.data.data.sessionId !== this.sessionId) {
      this.sendError("INVALID_MESSAGE", "ready payload is invalid", {
        replyTo: message.id,
      });
      return;
    }
    const readyCursor = parsed.data.data.streams?.find(
      (cursor) => cursor.stream === GLOBAL_STREAM,
    );
    if (readyCursor) {
      this.#processedSeq = Math.max(
        this.#processedSeq,
        readyCursor.processedSeq,
      );
      this.#lastAckedSeq = Math.max(
        this.#lastAckedSeq,
        readyCursor.processedSeq,
      );
      this.#lastDeliveredDurableSeq = Math.max(
        this.#lastDeliveredDurableSeq,
        readyCursor.processedSeq,
      );
    }

    if (this.#phase === "snapshot_required") {
      this.sendResyncRequired("snapshot_required", "load_snapshot");
      return;
    }

    if (this.#replayFromSeq !== undefined) {
      await this.performReplay({
        replayId: createId("rpl"),
        fromSeq: this.#replayFromSeq,
        reason: "resume",
      });
    }
    this.#phase = "live";
    this.drainPendingLive();
  }

  private handleAck(message: NerveMessage): void {
    const parsed = ackMessageSchema.safeParse(message);
    if (!parsed.success || parsed.data.data.sessionId !== this.sessionId) {
      this.sendError("ACK_INVALID", "ack payload is invalid", {
        replyTo: message.id,
      });
      return;
    }
    const ack = parsed.data.data as AckData;
    const global = ack.streams.find(
      (stream) => stream.stream === GLOBAL_STREAM,
    );
    if (!global) return;
    if (global.processedSeq > this.state.events.latestDurableSeq) {
      this.sendError("ACK_INVALID", "ack cursor is ahead of the server", {
        replyTo: message.id,
      });
      return;
    }
    this.#lastAckedSeq = Math.max(this.#lastAckedSeq, global.processedSeq);
    this.#processedSeq = Math.max(this.#processedSeq, global.processedSeq);
    this.maybeSendFlowUpdate();
  }

  private async handleReplayRequest(message: NerveMessage): Promise<void> {
    const parsed = replayRequestMessageSchema.safeParse(message);
    if (!parsed.success || parsed.data.data.sessionId !== this.sessionId) {
      this.sendError("INVALID_MESSAGE", "replay.request payload is invalid", {
        replyTo: message.id,
      });
      return;
    }
    const request = parsed.data.data as ReplayRequestData;
    const stream = request.streams.find(
      (candidate) => candidate.stream === GLOBAL_STREAM,
    );
    if (!stream) {
      this.sendError(
        "STREAM_NOT_FOUND",
        "Only the global stream is supported",
        {
          replyTo: message.id,
        },
      );
      return;
    }
    await this.performReplay({
      replayId: request.replayId,
      fromSeq: stream.fromSeq,
      toSeq: stream.toSeq,
      reason: request.reason,
      includeTransientIfAvailable:
        request.preferences?.includeTransientIfAvailable,
      correlationId: message.id,
    });
    this.#phase = "live";
    this.drainPendingLive();
  }

  private handleLiveEvent(event: EventEnvelope): void {
    if (this.#phase === "closed") return;
    if (
      event.seq <= this.#lastDeliveredDurableSeq &&
      event.durability === "durable"
    )
      return;
    if (this.#phase !== "live") {
      this.#pendingLive.push(event);
      return;
    }
    this.#queue.enqueueLive(event);
    this.#queue.coalesceTransientOverflow(PROTOCOL_LIMITS.maxQueuedTransient);
    this.#queue.dropTransientOverflow(PROTOCOL_LIMITS.maxQueuedTransient);
    this.scheduleFlush();
  }

  private async performReplay(options: {
    replayId: string;
    fromSeq: number;
    toSeq?: number;
    reason: ReplayRequestData["reason"];
    includeTransientIfAvailable?: boolean;
    correlationId?: string;
  }): Promise<void> {
    this.#phase = "replaying";
    this.#flowMode = "catching_up";
    const result = await planReplay(this.state, {
      replayId: options.replayId,
      fromSeq: options.fromSeq,
      toSeq: options.toSeq,
      preferences: {
        includeTransientIfAvailable: options.includeTransientIfAvailable,
      },
    });
    if (!result.available) {
      this.sendMessage(
        createProtocolMessage(
          "replay.unavailable",
          replayUnavailableData(
            this.sessionId,
            result,
            this.state.events.latestSeq,
            this.state.events.bufferedFloorSeq(),
          ),
          { source: orchestratorSource(this.state.daemonId) },
        ),
      );
      this.sendResyncRequired("snapshot_required", "load_snapshot");
      return;
    }

    const { plan } = result;
    this.send(
      "replay.started",
      {
        sessionId: this.sessionId,
        replayId: plan.replayId,
        streams: [
          {
            stream: GLOBAL_STREAM,
            fromSeq: plan.fromSeq,
            toSeq: plan.toSeq,
            latestSeq: plan.latestSeq,
            durableFromSeq: plan.durableFirstSeq,
            durableToSeq: plan.durableLastSeq,
            estimatedEvents: plan.events.length,
            source: plan.source,
            transientPolicy: plan.transientPolicy,
          },
        ],
      },
      { correlationId: options.correlationId },
    );

    this.#lastDeliveredDurableSeq = plan.fromSeq;
    const sent = this.sendEventBatches(plan.events, "replay", {
      replayId: plan.replayId,
      fromSeq: plan.fromSeq,
      toSeq: plan.toSeq,
    });
    const durableCompleteThroughSeq = plan.durableLastSeq ?? plan.fromSeq;
    this.#lastDeliveredDurableSeq = Math.max(
      this.#lastDeliveredDurableSeq,
      durableCompleteThroughSeq,
    );
    this.send(
      "replay.complete",
      {
        sessionId: this.sessionId,
        replayId: plan.replayId,
        streams: [
          {
            stream: GLOBAL_STREAM,
            fromSeq: plan.fromSeq,
            toSeq: plan.toSeq,
            latestSeq: this.state.events.latestSeq,
            durableCompleteThroughSeq,
            sentEvents: sent.events,
            sentDurableEvents: sent.durable,
            sentTransientEvents: sent.transient,
          },
        ],
        liveDelivery: "resuming",
      },
      { correlationId: options.correlationId },
    );
  }

  private scheduleFlush(delayMs = 16): void {
    if (this.#flushTimer !== undefined || this.#phase === "closed") return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined;
      this.flushQueue();
    }, delayMs);
    this.#flushTimer.unref();
  }

  private flushQueue(): void {
    if (this.#phase === "closed") return;
    for (;;) {
      const control = this.#queue.shiftControl();
      if (!control) break;
      if (!this.sendMessage(control)) return;
    }
    for (;;) {
      const replayBatch = this.#queue.shiftReplayBatch();
      if (!replayBatch) break;
      this.sendEventBatches(replayBatch, "replay");
    }
    const durable = this.#queue.shiftDurable(PROTOCOL_LIMITS.maxBatchEvents);
    if (durable.length > 0) this.sendEventBatches(durable, "live");
    const transient = this.#queue.shiftTransient(
      PROTOCOL_LIMITS.maxBatchEvents,
    );
    if (transient.length > 0 && this.#flowMode !== "degraded") {
      this.sendEventBatches(transient, "live");
    }
    const stats = this.#queue.stats();
    if (
      stats.controlCount > 0 ||
      stats.replayCount > 0 ||
      stats.durableCount > 0 ||
      stats.transientCount > 0
    ) {
      this.scheduleFlush(this.#flowMode === "normal" ? 16 : 75);
    }
    this.maybeSendFlowUpdate();
  }

  private sendEventBatches(
    events: EventEnvelope[],
    reason: "live" | "replay" | "catchup" | "snapshot_delta",
    replay?: { replayId: string; fromSeq: number; toSeq?: number },
  ): { events: number; durable: number; transient: number } {
    let sentEvents = 0;
    let sentDurable = 0;
    let sentTransient = 0;
    for (const chunk of chunkEvents(
      events,
      PROTOCOL_LIMITS.maxBatchEvents,
      PROTOCOL_LIMITS.maxBatchBytes,
    )) {
      if (chunk.length === 0) continue;
      const previousDurableSeq = this.#lastDeliveredDurableSeq;
      const data = buildEventBatch(chunk, {
        reason,
        previousDurableSeq,
        replay,
      });
      const parsed = eventBatchMessageSchema.parse(
        createProtocolMessage("event.batch", data, {
          source: orchestratorSource(this.state.daemonId),
        }),
      );
      if (!this.sendMessage(parsed)) break;
      sentEvents += chunk.length;
      const durable = chunk.filter((event) => event.durability === "durable");
      sentDurable += durable.length;
      sentTransient += chunk.length - durable.length;
      const lastDurable = durable.at(-1);
      if (lastDurable) this.#lastDeliveredDurableSeq = lastDurable.seq;
      this.#highestReceivedSeq = Math.max(
        this.#highestReceivedSeq,
        chunk.at(-1)?.seq ?? 0,
      );
    }
    this.maybeSendFlowUpdate();
    return {
      events: sentEvents,
      durable: sentDurable,
      transient: sentTransient,
    };
  }

  private drainPendingLive(): void {
    const pending = this.#pendingLive
      .splice(0)
      .sort((a, b) => a.seq - b.seq)
      .filter(
        (event) =>
          event.seq > this.#lastDeliveredDurableSeq ||
          event.durability !== "durable",
      );
    for (const event of pending) this.#queue.enqueueLive(event);
    this.scheduleFlush(0);
    this.#flowMode = "normal";
  }

  private sendResyncRequired(
    reason: "snapshot_required" | "queue_limit_exceeded",
    action: "load_snapshot" | "reconnect",
  ): void {
    this.#flowMode = "resync_required";
    this.send("flow.update", {
      sessionId: this.sessionId,
      scope: { stream: GLOBAL_STREAM },
      mode: "resync_required",
      reason,
      stats: {
        latestSeq: this.state.events.latestSeq,
        processedSeq: this.#processedSeq,
      },
      action: {
        type: action,
        message: "Protocol session requires resynchronization",
      },
    });
  }

  private maybeSendFlowUpdate(): void {
    if (this.#phase === "closed") return;
    const ackLag = Math.max(
      0,
      this.#lastDeliveredDurableSeq - this.#lastAckedSeq,
    );
    const queue = this.#queue.stats();
    const decision = decideFlow({
      currentMode: this.#flowMode,
      ackLag,
      bufferedBytes: this.ws.bufferedAmount,
      queue,
      replayInProgress: this.#phase === "replaying",
    });
    if (decision.mode === this.#flowMode) return;
    if (decision.mode === "resync_required") {
      this.sendResyncRequired(
        "queue_limit_exceeded",
        decision.action === "reconnect" ? "reconnect" : "load_snapshot",
      );
      return;
    }
    this.#flowMode = decision.mode;
    this.send("flow.update", {
      sessionId: this.sessionId,
      scope: { stream: GLOBAL_STREAM },
      mode: decision.mode,
      reason: decision.reason,
      stats: {
        unackedDurableEvents: ackLag,
        queuedDurableEvents: queue.durableCount,
        queuedTransientEvents: queue.transientCount,
        queuedBytes: queue.queuedBytes,
        droppedTransientEvents: queue.droppedTransientCount,
        coalescedTransientEvents: queue.coalescedTransientCount,
        transportBufferedBytes: this.ws.bufferedAmount,
        latestSeq: this.state.events.latestSeq,
        processedSeq: this.#lastAckedSeq,
      },
      action: { type: decision.action },
    });
  }

  private startHeartbeat(): void {
    this.#heartbeatTimer = setInterval(() => {
      this.send("heartbeat", {
        sessionId: this.sessionId,
        sentAt: new Date().toISOString(),
        latestSeq: this.state.events.latestSeq,
        processed: [
          { stream: GLOBAL_STREAM, processedSeq: this.#lastAckedSeq },
        ],
        serverLoad: { eventQueueDepth: this.#pendingLive.length },
      });
    }, PROTOCOL_HEARTBEAT.intervalMs);
    this.#heartbeatTimer.unref();
  }

  private send<TData>(
    kind: string,
    data: TData,
    options: Parameters<typeof createProtocolMessage>[2] = {},
  ): boolean {
    return this.sendMessage(
      createProtocolMessage(kind, data, {
        source: orchestratorSource(this.state.daemonId),
        ...options,
      }),
    );
  }

  private sendMessage(message: NerveMessage): boolean {
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch {
      this.close(1011, "Protocol send failed");
      return false;
    }
  }

  private sendError(
    code: NerveErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      close?: boolean;
      replyTo?: string;
      details?: Record<string, unknown>;
    } = {},
  ): void {
    const data: ProtocolErrorData = protocolErrorData(code, message, {
      retryable: options.retryable ?? false,
      close: options.close,
      details: options.details,
    });
    this.sendMessage(
      protocolErrorMessageSchema.parse(
        createProtocolMessage("error", data, {
          source: orchestratorSource(this.state.daemonId),
          replyTo: options.replyTo,
          correlationId: options.replyTo,
        }),
      ),
    );
  }

  private close(code: number, reason: string): void {
    if (this.#phase === "closed") return;
    try {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.close(code, reason);
      else if (this.ws.readyState !== WebSocket.CLOSED) this.ws.terminate();
    } finally {
      this.dispose();
    }
  }

  private dispose(): void {
    if (this.#phase === "closed") return;
    this.#phase = "closed";
    clearTimeout(this.#handshakeTimer);
    clearInterval(this.#heartbeatTimer);
    clearTimeout(this.#flushTimer);
    this.#unsubscribe?.();
    this.#pendingLive.length = 0;
    this.#queue.clear();
  }
}

function resumeCursor(hello: HelloData): number {
  const global = hello.resume?.streams?.find(
    (stream: StreamCursor) => stream.stream === GLOBAL_STREAM,
  );
  return global?.processedSeq ?? hello.resume?.lastProcessedSeq ?? 0;
}
