import type {
  EventEnvelope,
  EventNotifyData,
  NerveMessage,
  NotifyEvent,
  OperationName,
  OperationParams,
  OperationResult,
  PeerDescriptor,
  ProtocolRequestData,
  ProtocolV1Message,
  ReadyPeerStatus,
  StreamCursor,
  StreamSubscriptionUpdatedData,
  WelcomeData,
} from "@nervekit/contracts";
import { STREAM_SUBSCRIPTION_CAPABILITY } from "@nervekit/contracts";
import {
  applyEventBatch,
  createClientEventStreamState,
  markProcessed,
  type ClientEventStreamState,
} from "./event-stream.js";
import type { MessageFactory, MessageFactoryOptions } from "./messages.js";
import type {
  ProtocolClock,
  ProtocolDiagnosticsPublisher,
  ProtocolIdSource,
  ProtocolTimers,
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
  readonly send: (message: NerveMessage) => void | Promise<void>;
  readonly onMessage?: (message: ProtocolV1Message) => void | Promise<void>;
  readonly awaitReady?: (welcome: WelcomeData) => void | Promise<void>;
  readonly readyStatus?: () => ReadyPeerStatus | undefined;
  readonly onReady?: (welcome: WelcomeData) => void | Promise<void>;
  readonly onSnapshotRequired?: (stream: string) => void | Promise<void>;
  /**
   * The server reported this stream as gone (deleted/unknown). The
   * application should drop its cursor and any dependent view state.
   */
  readonly onStreamUnavailable?: (stream: string) => void | Promise<void>;
  readonly applyEvent?: (
    stream: string,
    event: EventEnvelope<Record<string, unknown>>,
  ) => void | Promise<void>;
  readonly onNotify?: (
    events: readonly NotifyEvent[],
    message: ProtocolV1Message & { kind: "event.notify" },
  ) => void | Promise<void>;
  readonly rpcDispatcher?: import("./rpc.js").RpcDispatcher;
  readonly onDisconnect?: (error: Error) => void | Promise<void>;
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
  readonly #activeSubscriptions = new Set<string>();
  readonly #rpc: RpcClient;
  readonly #clock: ProtocolClock;
  readonly #timers: ProtocolTimers;
  readonly #ids: ProtocolIdSource;
  readonly #pendingSubscriptions = new Map<
    string,
    {
      cursors: readonly StreamCursor[];
      resolve: (data: StreamSubscriptionUpdatedData) => void;
      reject: (error: Error) => void;
      timeout: unknown;
    }
  >();

  #heartbeatInterval?: unknown;
  #heartbeatWatchdog?: unknown;
  #lastReceivedAt = 0;
  #acceptingPeer?: PeerDescriptor;
  #localPeer?: PeerDescriptor;
  #addressedPeer?: PeerDescriptor;
  #negotiatedCapabilities: string[] = [];
  #resubscribeScheduled = false;

  constructor(options: ClientSessionOptions) {
    this.#options = options;
    this.#clock = options.clock ?? systemProtocolClock;
    this.#timers = options.timers ?? systemProtocolTimers;
    this.#ids = options.ids ?? systemProtocolIds;
    this.resetStreams(options.cursors?.() ?? []);
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
    const capabilities = new Set(this.#options.capabilities ?? []);
    capabilities.add(STREAM_SUBSCRIPTION_CAPABILITY);
    const requiredCapabilities = new Set(
      this.#options.requiredCapabilities ?? [],
    );
    requiredCapabilities.add(STREAM_SUBSCRIPTION_CAPABILITY);
    const hello = this.#options.createMessage("hello", {
      requestedVersion: 1,
      capabilities: [...capabilities],
      requiredCapabilities: [...requiredCapabilities],
      encodings: ["json"],
    });
    this.#localPeer = hello.source;
    this.#addressedPeer = hello.target;
    this.state = "hello_sent";
    await this.#options.send(hello);
  }

  async receive(message: ProtocolV1Message): Promise<void> {
    this.#lastReceivedAt = this.#clock.now();
    if (this.state === "hello_sent") {
      await this.#receiveWelcome(message);
      return;
    }
    if (this.state !== "ready") {
      throw new SessionStateError(
        `Cannot receive ${message.kind} while ${this.state}`,
      );
    }
    if (
      !this.#acceptingPeer ||
      !this.#localPeer ||
      !samePeer(message.source, this.#acceptingPeer) ||
      !samePeer(message.target, this.#localPeer)
    ) {
      throw new SessionStateError(
        "Server message peers do not match the negotiated client session",
      );
    }

    const rpcHandled = this.#rpc.handle(message);
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
    if (message.kind === "stream.subscription.updated") {
      this.#receiveSubscriptionUpdated(message.data);
      return;
    }
    if (message.kind === "event.batch") {
      await this.#receiveEventBatch(message);
      return;
    }
    if (message.kind === "event.notify") {
      await this.#options.onNotify?.(message.data.events, message);
      return;
    }
    if (message.kind === "error" && message.data.close) {
      await this.#options.onMessage?.(message);
      this.disconnect(new Error(message.data.message));
      return;
    }
    if (rpcHandled) return;
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

  async subscribe(
    cursors: readonly StreamCursor[],
  ): Promise<StreamSubscriptionUpdatedData> {
    if (this.state !== "ready" || !this.sessionId) {
      throw new SessionStateError(
        "Stream subscriptions require a ready session",
      );
    }
    if (
      !this.#negotiatedCapabilities.includes(STREAM_SUBSCRIPTION_CAPABILITY)
    ) {
      throw new SessionStateError("Stream subscriptions were not negotiated");
    }
    const names = cursors.map((cursor) => cursor.stream);
    if (new Set(names).size !== names.length) {
      throw new SessionStateError(
        "Stream subscriptions must not contain duplicate streams",
      );
    }
    const subscriptionId = this.#ids.create("sub");
    const result = new Promise<StreamSubscriptionUpdatedData>(
      (resolve, reject) => {
        const timeout = this.#timers.setTimeout(() => {
          this.#pendingSubscriptions.delete(subscriptionId);
          reject(new Error("Stream subscription update timed out"));
        }, this.#options.rpcTimeoutMs ?? 30_000);
        this.#pendingSubscriptions.set(subscriptionId, {
          cursors: [...cursors],
          resolve,
          reject,
          timeout,
        });
      },
    );
    try {
      await this.#options.send(
        this.#options.createMessage("stream.subscription.set", {
          sessionId: this.sessionId,
          subscriptionId,
          streams: [...cursors],
        }),
      );
    } catch (error) {
      const pending = this.#pendingSubscriptions.get(subscriptionId);
      if (pending) {
        this.#pendingSubscriptions.delete(subscriptionId);
        this.#timers.clearTimeout(pending.timeout);
        pending.reject(toError(error));
      }
    }
    return result;
  }

  async publishEventBatch(
    data: Extract<ProtocolV1Message, { kind: "event.batch" }>["data"],
  ): Promise<void> {
    if (this.state !== "ready") {
      throw new SessionStateError("Event publication requires a ready session");
    }
    await this.#options.send(this.#options.createMessage("event.batch", data));
  }

  async publishNotify(data: EventNotifyData): Promise<void> {
    if (this.state !== "ready") {
      throw new SessionStateError(
        "Notify publication requires a ready session",
      );
    }
    await this.#options.send(this.#options.createMessage("event.notify", data));
  }

  request<M extends OperationName>(
    method: M,
    params: OperationParams<M>,
    options: Pick<
      ProtocolRequestData,
      "idempotencyKey" | "timeoutMs" | "expect"
    > &
      Partial<
        Pick<
          MessageFactoryOptions,
          "correlationId" | "causationId" | "traceId" | "target"
        >
      > = {},
  ): Promise<OperationResult<M>> {
    if (this.state !== "ready") {
      throw new SessionStateError("RPC requests require a ready session");
    }
    return this.#rpc.request(method, params, options);
  }

  resetStreams(cursors: readonly StreamCursor[]): void {
    const names = new Set(cursors.map((cursor) => cursor.stream));
    for (const stream of [...this.#streams.keys()]) {
      if (!names.has(stream)) this.#streams.delete(stream);
    }
    for (const cursor of cursors) {
      this.#streams.set(
        cursor.stream,
        createClientEventStreamState(cursor.processedSeq),
      );
    }
  }

  currentCursors(): StreamCursor[] {
    return [...this.#streams].map(([stream, state]) => ({
      stream,
      processedSeq: state.processedSeq,
    }));
  }

  disconnect(error = new Error("Protocol transport disconnected")): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.#stopHeartbeat();
    this.#rpc.disconnect(error);
    this.#rejectPendingSubscriptions(error);
    this.#activeSubscriptions.clear();
    void this.#options.onDisconnect?.(error);
  }

  async close(
    reason: "client_closing" | "restart_required" | "other" = "client_closing",
    message?: string,
  ): Promise<void> {
    if (this.state === "closed" || this.state === "closing") return;
    this.state = "closing";
    this.#stopHeartbeat();
    if (this.sessionId) {
      await this.#options.send(
        this.#options.createMessage("goodbye", {
          sessionId: this.sessionId,
          reason,
          message,
        }),
      );
    }
    this.disconnect(new Error(message ?? reason));
  }

  async #receiveWelcome(message: ProtocolV1Message): Promise<void> {
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
    if (
      !this.#localPeer ||
      !this.#addressedPeer ||
      !samePeer(message.target, this.#localPeer) ||
      !samePeer(message.source, welcome.acceptingPeer) ||
      !matchesAddressedPeer(this.#addressedPeer, welcome.acceptingPeer)
    ) {
      this.state = "closed";
      throw new SessionStateError(
        "Welcome peers do not match the addressed client session",
      );
    }
    const required = new Set(this.#options.requiredCapabilities ?? []);
    required.add(STREAM_SUBSCRIPTION_CAPABILITY);
    const missing = [...required].filter(
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
    this.#negotiatedCapabilities = [...welcome.capabilities];
    await this.#options.awaitReady?.(welcome);
    this.state = "ready";
    await this.#options.send(
      this.#options.createMessage("ready", {
        sessionId: welcome.sessionId,
        status: this.#options.readyStatus?.(),
      }),
    );
    this.#startHeartbeat(welcome.heartbeat);
    await this.#rpc.retryPending();
    await this.#options.onReady?.(welcome);
  }

  #receiveSubscriptionUpdated(data: StreamSubscriptionUpdatedData): void {
    if (data.sessionId !== this.sessionId) {
      throw new SessionStateError("Subscription session id mismatch");
    }
    const pending = this.#pendingSubscriptions.get(data.subscriptionId);
    if (!pending) {
      throw new SessionStateError(
        `Unexpected subscription response: ${data.subscriptionId}`,
      );
    }
    this.#pendingSubscriptions.delete(data.subscriptionId);
    this.#timers.clearTimeout(pending.timeout);
    if (!data.accepted) {
      pending.reject(new StreamSubscriptionError(data));
      return;
    }
    this.resetStreams(pending.cursors);
    this.#activeSubscriptions.clear();
    for (const stream of data.streams) {
      if (stream.mode === "unavailable") {
        this.#streams.delete(stream.stream);
        queueMicrotask(
          () => void this.#options.onStreamUnavailable?.(stream.stream),
        );
      } else if (stream.mode === "snapshot_required") {
        queueMicrotask(
          () => void this.#options.onSnapshotRequired?.(stream.stream),
        );
      } else {
        this.#activeSubscriptions.add(stream.stream);
      }
    }
    pending.resolve(data);
  }

  async #receiveEventBatch(
    message: ProtocolV1Message & { kind: "event.batch" },
  ): Promise<void> {
    const stream = message.data.stream;
    if (!this.#activeSubscriptions.has(stream)) {
      throw new SessionStateError(
        `Received event batch for unsubscribed stream ${stream}`,
      );
    }
    const state = this.#streams.get(stream);
    if (!state)
      throw new SessionStateError(`Missing cursor for stream ${stream}`);
    const events: EventEnvelope<Record<string, unknown>>[] = [];
    const result = applyEventBatch(
      message.data,
      state,
      (event) => events.push(event),
      stream,
    );
    if (result.gap) {
      console.warn(
        `Protocol gap on ${stream}: expected ${result.gap.expectedSeq}, received ${result.gap.receivedSeq}; resubscribing`,
      );
      await this.#options.diagnostics?.publish({
        type: "subscription",
        stream,
      });
      this.#scheduleResubscribe();
      return;
    }
    for (const event of events) {
      await this.#options.applyEvent?.(stream, event);
      markProcessed(state, event.seq);
    }
  }

  #scheduleResubscribe(): void {
    if (this.#resubscribeScheduled) return;
    this.#resubscribeScheduled = true;
    queueMicrotask(() => {
      this.#resubscribeScheduled = false;
      const cursors = this.currentCursors().filter((cursor) =>
        this.#activeSubscriptions.has(cursor.stream),
      );
      void this.subscribe(cursors).catch((error: unknown) => {
        this.disconnect(toError(error));
      });
    });
  }

  #startHeartbeat(heartbeat: { intervalMs: number; timeoutMs: number }): void {
    this.#stopHeartbeat();
    this.#lastReceivedAt = this.#clock.now();
    this.#heartbeatInterval = this.#timers.setInterval(() => {
      if (this.state !== "ready" || !this.sessionId) return;
      void this.#options.send(
        this.#options.createMessage("heartbeat", {
          sessionId: this.sessionId,
          sentAt: this.#clock.isoNow(),
        }),
      );
    }, heartbeat.intervalMs);
    this.#heartbeatWatchdog = this.#timers.setInterval(
      () => {
        if (
          this.state === "ready" &&
          this.#clock.now() - this.#lastReceivedAt > heartbeat.timeoutMs
        ) {
          this.disconnect(new Error("Protocol heartbeat timed out"));
        }
      },
      Math.max(1, heartbeat.intervalMs),
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

  #rejectPendingSubscriptions(error: Error): void {
    for (const pending of this.#pendingSubscriptions.values()) {
      this.#timers.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pendingSubscriptions.clear();
  }
}

function samePeer(left: PeerDescriptor, right: PeerDescriptor): boolean {
  return left.role === right.role && left.id === right.id;
}

function matchesAddressedPeer(
  addressed: PeerDescriptor,
  actual: PeerDescriptor,
): boolean {
  return (
    addressed.role === actual.role &&
    (!addressed.id || addressed.id === actual.id)
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class StreamSubscriptionError extends Error {
  readonly response: StreamSubscriptionUpdatedData;

  constructor(response: StreamSubscriptionUpdatedData) {
    super(response.reason ?? "Stream subscription rejected");
    this.name = "StreamSubscriptionError";
    this.response = response;
  }
}

export class SessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStateError";
  }
}
