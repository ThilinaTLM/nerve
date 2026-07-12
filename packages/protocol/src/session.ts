import type {
  EventEnvelope,
  HelloData,
  NerveMessage,
  OperationName,
  OperationParams,
  OperationResult,
  ProtocolRequestData,
  ReplayUnavailableData,
  PeerDescriptor,
  ProtocolLimits,
  ProtocolV1Message,
  StreamCursor,
  StreamState,
  WelcomeData,
} from "@nervekit/contracts";
import { buildEventBatch } from "./event-batch.js";
import type { MessageFactory } from "./messages.js";
import type { ReplaySource } from "./ports.js";
import { ProcessedAckTracker } from "./ack-tracker.js";
import {
  applyEventBatch,
  createClientEventStreamState,
  markProcessed,
  resetClientEventStreamState,
  type ClientEventStreamState,
} from "./event-stream.js";
import { RpcClient, type RpcDispatcher } from "./rpc.js";

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
  readonly rpcTimeoutMs?: number;
}

export class ProtocolClientSession {
  state: ClientSessionState = "idle";
  sessionId?: string;
  readonly #options: ClientSessionOptions;
  readonly #streams = new Map<string, ClientEventStreamState>();
  readonly #acks: ProcessedAckTracker;
  readonly #rpc: RpcClient;
  readonly #replaying = new Set<string>();
  readonly #liveDuringReplay = new Map<
    string,
    Array<ProtocolV1Message & { kind: "event.batch" }>
  >();

  constructor(options: ClientSessionOptions) {
    this.#options = options;
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
    if (this.state === "hello_sent") {
      if (message.kind === "error") {
        this.state = "closed";
        await this.#options.onMessage?.(message);
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
      await this.#options.send(
        this.#options.createMessage("ready", {
          sessionId: welcome.sessionId,
          streams: this.#options.cursors?.() as StreamCursor[] | undefined,
        }),
      );
      this.state = "ready";
      if (welcome.resume.mode === "snapshot_required") {
        await this.#options.onSnapshotRequired?.(welcome);
      }
      await this.#options.onReady?.(welcome);
      return;
    }
    if (this.state !== "ready") {
      throw new SessionStateError(
        `Cannot receive ${message.kind} while ${this.state}`,
      );
    }
    if (this.#rpc.handle(message)) return;
    if (message.kind === "replay.started") {
      for (const stream of message.data.streams) {
        this.#replaying.add(stream.stream);
      }
      await this.#options.onMessage?.(message);
      return;
    }
    if (message.kind === "event.batch") {
      if (
        message.data.reason === "live" &&
        this.#replaying.has(message.data.stream)
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
        this.#replaying.delete(stream.stream);
        const buffered = this.#liveDuringReplay.get(stream.stream) ?? [];
        this.#liveDuringReplay.delete(stream.stream);
        for (const batch of buffered) await this.#receiveEventBatch(batch);
      }
      await this.#options.onMessage?.(message);
      return;
    }
    if (message.kind === "replay.unavailable") {
      await this.#options.onReplayUnavailable?.(message);
      return;
    }
    if (message.kind === "flow.update") {
      await this.#options.onFlowUpdate?.(message);
      return;
    }
    if (message.kind === "heartbeat") {
      await this.#options.send(
        this.#options.createMessage("heartbeat", {
          sessionId: this.sessionId,
          sentAt: new Date().toISOString(),
          processed: this.#acks.cursors(),
        }),
      );
      return;
    }
    if (message.kind === "goodbye") {
      this.#rpc.close();
      this.state = "closed";
      return;
    }
    await this.#options.onMessage?.(message);
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
          replayId: `rpl_${globalThis.crypto.randomUUID()}`,
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
      await this.#options.send(
        this.#options.createMessage("event.ack", {
          sessionId: this.sessionId,
          ackId: `ack_${globalThis.crypto.randomUUID()}`,
          streams: this.#acks.cursors(),
          received: [{ stream, highestSeq: result.highestReceivedSeq }],
        }),
      );
    }
  }

  async close(
    reason: "client_closing" | "protocol_error" = "client_closing",
  ): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closing";
    await this.#options.send(
      this.#options.createMessage("goodbye", {
        sessionId: this.sessionId,
        reason,
        finalCursors: this.#options.cursors?.() as StreamCursor[] | undefined,
      }),
    );
    this.#rpc.close();
    this.state = "closed";
  }
}

export type ServerSessionState =
  | "awaiting_hello"
  | "awaiting_ready"
  | "ready"
  | "closing"
  | "closed";

export interface SessionResumeDecision {
  readonly accepted: boolean;
  readonly mode: "live" | "replay" | "snapshot_required" | "fresh";
  readonly reason?: string;
}

export interface ServerSessionOptions {
  readonly acceptingPeer: PeerDescriptor;
  readonly createMessage: MessageFactory;
  readonly capabilities?: readonly string[];
  readonly streams: () => readonly StreamState[];
  readonly limits: ProtocolLimits;
  readonly heartbeat: {
    readonly intervalMs: number;
    readonly timeoutMs: number;
  };
  readonly resume?: (
    hello: HelloData,
    source: PeerDescriptor,
  ) => SessionResumeDecision | Promise<SessionResumeDecision>;
  readonly sessionId: () => string;
  readonly send: (message: NerveMessage) => void | Promise<void>;
  readonly onReady?: (
    message: ProtocolV1Message & { kind: "ready" },
  ) => void | Promise<void>;
  readonly onMessage?: (message: ProtocolV1Message) => void | Promise<void>;
  readonly rpcDispatcher?: RpcDispatcher;
  readonly onAck?: (
    message: ProtocolV1Message & { kind: "event.ack" },
  ) => void | Promise<void>;
  readonly replaySource?: ReplaySource;
  readonly onReplayRequest?: (
    message: ProtocolV1Message & { kind: "replay.request" },
  ) => void | Promise<void>;
}

export class ProtocolServerSession {
  state: ServerSessionState = "awaiting_hello";
  sessionId?: string;
  peer?: PeerDescriptor;
  readonly #options: ServerSessionOptions;

  constructor(options: ServerSessionOptions) {
    this.#options = options;
  }

  async receive(message: ProtocolV1Message): Promise<void> {
    if (this.state === "awaiting_hello") {
      if (message.kind !== "hello") {
        throw new SessionStateError("hello must be the first client message");
      }
      this.peer = message.source;
      const unsupportedRequired = (
        message.data.requiredCapabilities ?? []
      ).filter(
        (capability) =>
          !(this.#options.capabilities ?? []).includes(capability),
      );
      if (unsupportedRequired.length > 0) {
        await this.fail(
          "CAPABILITY_REQUIRED",
          `Unsupported required capabilities: ${unsupportedRequired.join(", ")}`,
        );
        return;
      }
      const decision = (await this.#options.resume?.(
        message.data,
        message.source,
      )) ?? {
        accepted: false,
        mode: "fresh" as const,
      };
      this.sessionId = this.#options.sessionId();
      await this.#options.send(
        this.#options.createMessage(
          "welcome",
          {
            sessionId: this.sessionId,
            acceptingPeer: this.#options.acceptingPeer,
            acceptedVersion: 1,
            capabilities: [...(this.#options.capabilities ?? [])].filter(
              (capability) => message.data.capabilities.includes(capability),
            ),
            encoding: "json",
            streams: [...this.#options.streams()],
            limits: this.#options.limits,
            heartbeat: this.#options.heartbeat,
            resume: decision,
          },
          { target: message.source },
        ),
      );
      this.state = "awaiting_ready";
      return;
    }
    if (this.state === "awaiting_ready") {
      if (
        message.kind !== "ready" ||
        message.data.sessionId !== this.sessionId
      ) {
        throw new SessionStateError("Expected ready for the accepted session");
      }
      this.state = "ready";
      await this.#options.onReady?.(message);
      return;
    }
    if (this.state !== "ready") {
      throw new SessionStateError(
        `Cannot receive ${message.kind} while ${this.state}`,
      );
    }
    if (message.kind === "goodbye") {
      this.state = "closed";
      return;
    }
    if (message.kind === "request" && this.#options.rpcDispatcher) {
      const result = await this.#options.rpcDispatcher.dispatch(message);
      await this.#options.send(
        result.ok
          ? this.#options.createMessage(
              "response",
              {
                ok: true,
                method: message.data.method,
                result: result.result,
              },
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
    if (message.kind === "replay.request") {
      if (this.#options.replaySource) await this.#replay(message);
      else await this.#options.onReplayRequest?.(message);
      return;
    }
    if (message.kind === "heartbeat") {
      await this.#options.send(
        this.#options.createMessage(
          "heartbeat",
          {
            sessionId: this.sessionId,
            sentAt: new Date().toISOString(),
            processed: [],
          },
          { target: message.source },
        ),
      );
      return;
    }
    await this.#options.onMessage?.(message);
  }

  async #replay(
    message: ProtocolV1Message & { kind: "replay.request" },
  ): Promise<void> {
    const source = this.#options.replaySource;
    if (!source || !this.sessionId) return;
    const states = await source.streams();
    const stateByName = new Map(states.map((state) => [state.stream, state]));
    const unavailable: ReplayUnavailableData["streams"] = [];
    for (const request of message.data.streams) {
      const state = stateByName.get(request.stream);
      if (!state) {
        unavailable.push({
          stream: request.stream,
          requestedFromSeq: request.fromSeq,
          latestSeq: 0,
          reason: "stream_not_found",
        });
        continue;
      }
      const earliest = state.replayAvailableFromSeq ?? 1;
      if (request.fromSeq < earliest) {
        unavailable.push({
          stream: request.stream,
          requestedFromSeq: request.fromSeq,
          earliestAvailableSeq: earliest,
          latestSeq: state.latestSeq,
          reason: "cursor_too_old",
        });
      } else if (request.fromSeq > state.latestSeq + 1) {
        unavailable.push({
          stream: request.stream,
          requestedFromSeq: request.fromSeq,
          earliestAvailableSeq: earliest,
          latestSeq: state.latestSeq,
          reason: "cursor_ahead_of_server",
        });
      }
    }
    if (unavailable.length > 0) {
      await this.#options.send(
        this.#options.createMessage(
          "replay.unavailable",
          {
            sessionId: this.sessionId,
            replayId: message.data.replayId,
            streams: unavailable,
            recovery: { action: "load_snapshot" },
          },
          { target: message.source },
        ),
      );
      return;
    }

    const ranges = message.data.streams.map((request) => {
      const state = stateByName.get(request.stream) as StreamState;
      return {
        stream: request.stream,
        fromSeq: request.fromSeq,
        toSeq: request.toSeq ?? state.latestSeq,
        latestSeq: state.latestSeq,
        source: "log" as const,
      };
    });
    await this.#options.send(
      this.#options.createMessage(
        "replay.started",
        {
          sessionId: this.sessionId,
          replayId: message.data.replayId,
          streams: ranges,
        },
        { target: message.source },
      ),
    );

    const completed = [];
    for (const range of ranges) {
      const read = await source.read({
        stream: range.stream,
        fromSeq: range.fromSeq,
        toSeq: range.toSeq,
        limit: this.#options.limits.maxBatchEvents,
      });
      const events = [...read.events];
      if (!read.complete) {
        await this.#options.send(
          this.#options.createMessage(
            "replay.unavailable",
            {
              sessionId: this.sessionId,
              replayId: message.data.replayId,
              streams: [
                {
                  stream: range.stream,
                  requestedFromSeq: range.fromSeq,
                  latestSeq: range.latestSeq,
                  reason: "range_too_large",
                },
              ],
              recovery: { action: "load_snapshot" },
            },
            { target: message.source },
          ),
        );
        return;
      }
      if (events.length > 0) {
        await this.#options.send(
          this.#options.createMessage(
            "event.batch",
            buildEventBatch(events, {
              stream: range.stream,
              reason: "replay",
              previousDurableSeq: Math.max(0, range.fromSeq - 1),
              replay: {
                replayId: message.data.replayId,
                fromSeq: range.fromSeq,
                toSeq: range.toSeq,
                complete: true,
              },
            }),
            { target: message.source },
          ),
        );
      }
      const durable = events.filter((event) => event.durability === "durable");
      completed.push({
        stream: range.stream,
        fromSeq: range.fromSeq,
        toSeq: range.toSeq,
        latestSeq: range.latestSeq,
        durableCompleteThroughSeq:
          durable.at(-1)?.seq ?? Math.max(0, range.fromSeq - 1),
        sentEvents: events.length,
        sentDurableEvents: durable.length,
        sentTransientEvents: events.length - durable.length,
      });
    }
    await this.#options.send(
      this.#options.createMessage(
        "replay.complete",
        {
          sessionId: this.sessionId,
          replayId: message.data.replayId,
          streams: completed,
          liveDelivery: "resuming",
        },
        { target: message.source },
      ),
    );
  }

  async fail(
    code: "CAPABILITY_REQUIRED" | "INVALID_MESSAGE" | "UNKNOWN_MESSAGE_KIND",
    message: string,
  ): Promise<void> {
    this.state = "closing";
    await this.#options.send(
      this.#options.createMessage("error", {
        code,
        message,
        retryable: false,
        close: true,
      }),
    );
    this.state = "closed";
  }
}

export class SessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStateError";
  }
}
