import type {
  EventEnvelope,
  HelloData,
  NerveMessage,
  OperationName,
  OperationParams,
  OperationResult,
  PeerDescriptor,
  ProtocolRequestData,
  ProtocolV1Message,
  StreamCursor,
  WelcomeData,
} from "@nervekit/contracts";
import { ProcessedAckTracker } from "./ack-tracker.js";
import {
  applyEventBatch,
  createClientEventStreamState,
  markProcessed,
  resetClientEventStreamState,
  type ClientEventStreamState,
} from "./event-stream.js";
import type { MessageFactory } from "./messages.js";
import type {
  ProcessedEventSink,
  ProtocolClock,
  ProtocolDiagnosticsPublisher,
  ProtocolIdSource,
  ProtocolTimers,
  SnapshotRecovery,
} from "./ports.js";
import { RpcClient } from "./rpc.js";
import {
  systemProtocolClock,
  systemProtocolIds,
  systemProtocolTimers,
} from "./runtime.js";

export type ClientSessionState =
  | "idle"
  | "hello_sent"
  | "ready"
  | "closing"
  | "closed";

export interface ClientSessionOptions {
  readonly createMessage: MessageFactory;
  readonly capabilities?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
  readonly cursors?: () => readonly StreamCursor[];
  readonly sessionId?: () => string | undefined;
  readonly send: (message: NerveMessage) => void | Promise<void>;
  readonly onMessage?: (message: ProtocolV1Message) => void | Promise<void>;
  /** Optional host readiness gate resolved before the protocol ready frame. */
  readonly awaitReady?: (welcome: WelcomeData) => void | Promise<void>;
  readonly onReady?: (welcome: WelcomeData) => void | Promise<void>;
  readonly onSnapshotRequired?: (welcome: WelcomeData) => void | Promise<void>;
  readonly onReplayUnavailable?: (
    message: ProtocolV1Message,
  ) => void | Promise<void>;
  readonly applyEvent?: (
    stream: string,
    event: EventEnvelope<Record<string, unknown>>,
  ) => void | Promise<void>;
  readonly onFlowUpdate?: (message: ProtocolV1Message) => void | Promise<void>;
  readonly rpcDispatcher?: import("./rpc.js").RpcDispatcher;
  readonly onAck?: (
    message: ProtocolV1Message & { kind: "event.ack" },
  ) => void | Promise<void>;
  readonly onDisconnect?: (error: Error) => void | Promise<void>;
  readonly snapshotRecovery?: SnapshotRecovery;
  readonly installSnapshot?: (
    snapshot: unknown,
    cursors: readonly StreamCursor[],
    stateEpoch?: string,
  ) => void | Promise<void>;
  readonly processedEvents?: ProcessedEventSink;
  readonly diagnostics?: ProtocolDiagnosticsPublisher;
  readonly clock?: ProtocolClock;
  readonly timers?: ProtocolTimers;
  readonly ids?: ProtocolIdSource;
  readonly rpcTimeoutMs?: number;
}

export class ProtocolClientSession {
  state: ClientSessionState = "idle";
  sessionId?: string;
  readonly #options: ClientSessionOptions;
  readonly #streams = new Map<string, ClientEventStreamState>();
  readonly #acks: ProcessedAckTracker;
  readonly #rpc: RpcClient;
  readonly #replaying = new Map<string, Set<string>>();
  readonly #liveDuringReplay = new Map<
    string,
    Array<ProtocolV1Message & { kind: "event.batch" }>
  >();
  readonly #clock: ProtocolClock;
  readonly #timers: ProtocolTimers;
  readonly #ids: ProtocolIdSource;
  #heartbeatInterval?: unknown;
  #heartbeatWatchdog?: unknown;
  #lastReceivedAt = 0;
  #acceptingPeer?: PeerDescriptor;

  constructor(options: ClientSessionOptions) {
    this.#options = options;
    this.#clock = options.clock ?? systemProtocolClock;
    this.#timers = options.timers ?? systemProtocolTimers;
    this.#ids = options.ids ?? systemProtocolIds;
    const cursors = options.cursors?.() ?? [];
    this.#acks = new ProcessedAckTracker(cursors);
    for (const cursor of cursors) {
      this.#streams.set(
        cursor.stream,
        createClientEventStreamState(cursor.processedSeq),
      );
    }
    this.#rpc = new RpcClient({
      createMessage: options.createMessage,
      send: options.send,
      defaultTimeoutMs: options.rpcTimeoutMs,
      timers: this.#timers,
    });
  }

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "closed") {
      throw new Error(`Cannot start a client session from ${this.state}`);
    }
    const previousSessionId = this.#options.sessionId?.();
    const streams = this.#options.cursors?.();
    const data: HelloData = {
      requestedVersion: 1,
      capabilities: [...(this.#options.capabilities ?? [])],
      requiredCapabilities: this.#options.requiredCapabilities
        ? [...this.#options.requiredCapabilities]
        : undefined,
      encodings: ["json"],
      resume:
        previousSessionId || streams?.length
          ? {
              sessionId: previousSessionId,
              streams: streams ? [...streams] : undefined,
            }
          : undefined,
    };
    this.state = "hello_sent";
    await this.#options.send(this.#options.createMessage("hello", data));
  }

  async receive(message: ProtocolV1Message): Promise<void> {
    this.#lastReceivedAt = this.#clock.now();
    if (this.state === "hello_sent") {
      if (message.kind === "error") {
        await this.#options.onMessage?.(message);
        this.disconnect(new Error(message.data.message));
        return;
      }
      if (message.kind !== "welcome") {
        throw new SessionStateError(
          "Expected welcome as the first server message",
        );
      }
      const welcome = message.data;
      const missing = (this.#options.requiredCapabilities ?? []).filter(
        (capability) => !welcome.capabilities.includes(capability),
      );
      if (missing.length > 0) {
        this.state = "closed";
        throw new SessionStateError(
          `Server did not negotiate required capabilities: ${missing.join(", ")}`,
        );
      }
      this.sessionId = welcome.sessionId;
      this.#acceptingPeer = welcome.acceptingPeer;
      await this.#options.awaitReady?.(welcome);
      await this.#options.send(
        this.#options.createMessage("ready", {
          sessionId: welcome.sessionId,
          streams: this.#options.cursors?.() as StreamCursor[] | undefined,
        }),
      );
      this.state = "ready";
      this.#startHeartbeat(welcome.heartbeat);
      if (welcome.resume.mode === "snapshot_required") {
        if (this.#options.snapshotRecovery) {
          await this.#recoverSnapshot(
            "replay_unavailable",
            welcome.streams.map((stream) => stream.stream),
          );
        } else {
          await this.#options.onSnapshotRequired?.(welcome);
        }
      }
      await this.#rpc.retryPending();
      await this.#options.onReady?.(welcome);
      return;
    }
    if (this.state !== "ready") {
      throw new SessionStateError(
        `Cannot receive ${message.kind} while ${this.state}`,
      );
    }
    const rpcHandled = this.#rpc.handle(message);
    if (message.kind === "request" && this.#options.rpcDispatcher) {
      const result = await this.#options.rpcDispatcher.dispatch(message);
      await this.#options.send(
        result.ok
          ? this.#options.createMessage(
              "response",
              { ok: true, method: message.data.method, result: result.result },
              {
                target: message.source,
                replyTo: message.id,
                correlationId: message.id,
              },
            )
          : this.#options.createMessage("error", result.error, {
              target: message.source,
              replyTo: message.id,
              correlationId: message.id,
            }),
      );
      return;
    }
    if (message.kind === "event.ack") {
      await this.#options.onAck?.(message);
      return;
    }
    if (message.kind === "error" && message.data.close) {
      await this.#options.onMessage?.(message);
      this.disconnect(new Error(message.data.message));
      return;
    }
    if (rpcHandled) return;
    if (message.kind === "replay.started") {
      for (const stream of message.data.streams) {
        const replayIds = this.#replaying.get(stream.stream) ?? new Set();
        replayIds.add(message.data.replayId);
        this.#replaying.set(stream.stream, replayIds);
      }
      await this.#options.onMessage?.(message);
      return;
    }
    if (message.kind === "event.batch") {
      if (
        message.data.reason === "live" &&
        (this.#replaying.get(message.data.stream)?.size ?? 0) > 0
      ) {
        const buffered = this.#liveDuringReplay.get(message.data.stream) ?? [];
        buffered.push(message);
        this.#liveDuringReplay.set(message.data.stream, buffered);
        return;
      }
      await this.#receiveEventBatch(message);
      return;
    }
    if (message.kind === "replay.complete") {
      for (const stream of message.data.streams) {
        const replayIds = this.#replaying.get(stream.stream);
        replayIds?.delete(message.data.replayId);
        if (replayIds && replayIds.size > 0) continue;
        this.#replaying.delete(stream.stream);
        await this.#drainBufferedLive(stream.stream);
      }
      await this.#options.onMessage?.(message);
      return;
    }
    if (message.kind === "replay.unavailable") {
      const completedStreams: string[] = [];
      for (const stream of message.data.streams) {
        const replayIds = this.#replaying.get(stream.stream);
        replayIds?.delete(message.data.replayId);
        if (!replayIds || replayIds.size === 0) {
          this.#replaying.delete(stream.stream);
          completedStreams.push(stream.stream);
        }
      }
      if (this.#options.snapshotRecovery) {
        const reason = message.data.streams.some(
          (stream) => stream.reason === "cursor_ahead_of_server",
        )
          ? "ahead_cursor"
          : message.data.streams.some(
                (stream) => stream.reason === "cursor_too_old",
              )
            ? "retention_gap"
            : "replay_unavailable";
        await this.#recoverSnapshot(
          reason,
          message.data.streams.map((stream) => stream.stream),
        );
      }
      await this.#options.onReplayUnavailable?.(message);
      for (const stream of completedStreams)
        await this.#drainBufferedLive(stream);
      return;
    }
    if (message.kind === "flow.update") {
      await this.#options.onFlowUpdate?.(message);
      return;
    }
    if (message.kind === "heartbeat") return;
    if (message.kind === "goodbye") {
      this.disconnect(
        new Error(
          message.data.message ?? `Server closed: ${message.data.reason}`,
        ),
      );
      return;
    }
    await this.#options.onMessage?.(message);
  }

  async publishEventBatch(
    data: Extract<ProtocolV1Message, { kind: "event.batch" }>["data"],
  ): Promise<void> {
    if (this.state !== "ready")
      throw new SessionStateError("Event publication requires a ready session");
    await this.#options.send(this.#options.createMessage("event.batch", data));
  }

  request<M extends OperationName>(
    method: M,
    params: OperationParams<M>,
    options: Pick<
      ProtocolRequestData,
      "idempotencyKey" | "timeoutMs" | "expect"
    > = {},
  ): Promise<OperationResult<M>> {
    if (this.state !== "ready")
      throw new SessionStateError("RPC requests require a ready session");
    return this.#rpc.request(method, params, options);
  }

  /** Atomically installs every cursor returned by snapshot recovery. */
  resetStreams(cursors: readonly StreamCursor[]): void {
    const names = new Set(cursors.map((cursor) => cursor.stream));
    for (const name of [...this.#streams.keys()]) {
      if (!names.has(name)) this.#streams.delete(name);
    }
    for (const cursor of cursors) {
      const state =
        this.#streams.get(cursor.stream) ?? createClientEventStreamState();
      resetClientEventStreamState(state, cursor.processedSeq);
      this.#streams.set(cursor.stream, state);
    }
    this.#acks.reset(cursors);
    this.#replaying.clear();
    this.#liveDuringReplay.clear();
  }

  async #drainBufferedLive(stream: string): Promise<void> {
    const buffered = this.#liveDuringReplay.get(stream) ?? [];
    this.#liveDuringReplay.delete(stream);
    for (const batch of buffered) await this.#receiveEventBatch(batch);
  }

  async #receiveEventBatch(
    message: ProtocolV1Message & { kind: "event.batch" },
  ): Promise<void> {
    const stream = message.data.stream;
    const state = this.#streams.get(stream) ?? createClientEventStreamState(0);
    this.#streams.set(stream, state);
    const events: EventEnvelope<Record<string, unknown>>[] = [];
    const result = applyEventBatch(
      message.data,
      state,
      (event) => events.push(event),
      stream,
    );
    this.#acks.markReceived(stream, result.highestReceivedSeq);
    if (result.replayRequired) {
      await this.#options.send(
        this.#options.createMessage("replay.request", {
          sessionId: this.sessionId,
          replayId: this.#ids.create("rpl"),
          streams: [{ stream, fromSeq: result.replayRequired.fromSeq + 1 }],
          reason: result.replayRequired.reason,
        }),
      );
      return;
    }
    for (const event of events) {
      await this.#options.applyEvent?.(stream, event);
      if (event.durability === "durable") {
        markProcessed(state, event.seq);
        this.#acks.markProcessed(stream, event.seq);
      }
    }
    if (events.some((event) => event.durability === "durable")) {
      const cursors = this.#acks.cursors();
      await this.#options.processedEvents?.persist(cursors);
      await this.#options.send(
        this.#options.createMessage("event.ack", {
          sessionId: this.sessionId,
          ackId: this.#ids.create("ack"),
          streams: cursors,
          received: [{ stream, highestSeq: result.highestReceivedSeq }],
        }),
      );
    }
  }

  disconnect(error = new Error("Protocol transport disconnected")): void {
    if (this.state === "closed") return;
    this.#stopHeartbeat();
    this.#rpc.disconnect(error);
    this.state = "closed";
    void this.#options.onDisconnect?.(error);
  }

  async #recoverSnapshot(
    reason: "retention_gap" | "ahead_cursor" | "replay_unavailable",
    streams: readonly string[],
  ): Promise<void> {
    if (!this.#options.snapshotRecovery || !this.#acceptingPeer) return;
    const recovered = await this.#options.snapshotRecovery.load({
      peer: this.#acceptingPeer,
      reason,
      streams,
    });
    await this.#options.installSnapshot?.(
      recovered.snapshot,
      recovered.cursors,
      recovered.stateEpoch,
    );
    this.resetStreams(recovered.cursors);
    await this.#options.processedEvents?.persist(recovered.cursors);
    await this.#options.diagnostics?.publish({
      type: "snapshot",
      count: recovered.cursors.length,
    });
    if (this.state === "ready" && recovered.cursors.length > 0) {
      await this.#options.send(
        this.#options.createMessage("replay.request", {
          sessionId: this.sessionId,
          replayId: this.#ids.create("rpl"),
          streams: recovered.cursors.map((cursor) => ({
            stream: cursor.stream,
            fromSeq: cursor.processedSeq + 1,
          })),
          reason: "snapshot_delta",
        }),
      );
    }
  }

  #startHeartbeat(heartbeat: { intervalMs: number; timeoutMs: number }): void {
    this.#stopHeartbeat();
    this.#lastReceivedAt = this.#clock.now();
    this.#heartbeatInterval = this.#timers.setInterval(() => {
      if (this.state !== "ready") return;
      void this.#options.send(
        this.#options.createMessage("heartbeat", {
          sessionId: this.sessionId,
          sentAt: this.#clock.isoNow(),
          processed: this.#acks.cursors(),
        }),
      );
    }, heartbeat.intervalMs);
    this.#heartbeatWatchdog = this.#timers.setInterval(
      () => {
        if (
          this.state === "ready" &&
          this.#clock.now() - this.#lastReceivedAt > heartbeat.timeoutMs
        ) {
          void this.#options.diagnostics?.publish({ type: "heartbeat" });
          this.disconnect(new Error("Protocol heartbeat timed out"));
        }
      },
      Math.min(heartbeat.intervalMs, heartbeat.timeoutMs),
    );
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatInterval !== undefined)
      this.#timers.clearInterval(this.#heartbeatInterval);
    if (this.#heartbeatWatchdog !== undefined)
      this.#timers.clearInterval(this.#heartbeatWatchdog);
    this.#heartbeatInterval = undefined;
    this.#heartbeatWatchdog = undefined;
  }

  async close(
    reason: "client_closing" | "protocol_error" = "client_closing",
  ): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closing";
    this.#stopHeartbeat();
    await this.#options.send(
      this.#options.createMessage("goodbye", {
        sessionId: this.sessionId,
        reason,
        finalCursors: this.#acks.cursors(),
      }),
    );
    this.#rpc.close();
    this.state = "closed";
  }
}

export class SessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStateError";
  }
}
