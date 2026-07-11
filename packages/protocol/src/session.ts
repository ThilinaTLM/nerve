import type {
  EventEnvelope,
  HelloData,
  NerveMessage,
  OperationName,
  ProtocolRequestData,
  PeerDescriptor,
  ProtocolLimits,
  ProtocolV1Message,
  StreamCursor,
  StreamState,
  WelcomeData,
} from "@nervekit/contracts";
import type { MessageFactory } from "./messages.js";
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
    if (message.kind === "event.batch") {
      await this.#receiveEventBatch(message);
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

  request<TResult = unknown>(
    method: OperationName,
    params?: unknown,
    options: Pick<
      ProtocolRequestData,
      "idempotencyKey" | "timeoutMs" | "expect"
    > = {},
  ): Promise<TResult> {
    if (this.state !== "ready")
      throw new SessionStateError("RPC requests require a ready session");
    return this.#rpc.request<TResult>(method, params, options);
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
      await this.#options.onReplayRequest?.(message);
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
