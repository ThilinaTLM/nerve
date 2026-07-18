import type {
  EventEnvelope,
  GoodbyeData,
  NerveMessage,
  NotifyEvent,
  OperationName,
  OperationParams,
  OperationResult,
  PeerDescriptor,
  ProtocolErrorData,
  ProtocolRequestData,
  ProtocolV1Message,
  StreamCursor,
  StreamState,
  SubscribedStreamState,
} from "@nervekit/contracts";
import {
  RESYNC_REQUIRED_CLOSE_REASON,
  STREAM_SUBSCRIPTION_CAPABILITY,
  publicEventDefinition,
} from "@nervekit/contracts";
import {
  buildEventBatch,
  chunkEvents,
  estimateProtocolMessageBytes,
} from "./event-batch.js";
import { PrioritizedMessageSender } from "./priority-sender.js";
import { RpcClient, type RpcDispatcher } from "./rpc.js";
import { systemProtocolClock, systemProtocolTimers } from "./runtime.js";
import { ServerHeartbeat } from "./server-heartbeat.js";
import { SessionStateError } from "./client-session.js";
import type {
  ServerSessionOptions,
  ServerSessionState,
} from "./server-session-types.js";

const RESYNC_CLOSE_CODE = 1013;

export class ProtocolServerSession {
  state: ServerSessionState = "awaiting_hello";
  sessionId?: string;
  peer?: PeerDescriptor;

  readonly #options: ServerSessionOptions;
  readonly #heartbeat: ServerHeartbeat;
  readonly #timers: ReturnType<typeof resolveTimers>;
  readonly #sender: PrioritizedMessageSender;
  readonly #rpc: RpcClient;
  readonly #activeStreams = new Set<string>();
  readonly #streamStates = new Map<string, StreamState>();
  readonly #replaying = new Set<string>();
  readonly #pendingLive = new Map<string, EventEnvelope[]>();
  readonly #replayBufferedLive = new Map<string, EventEnvelope[]>();
  readonly #notifyQueue: NotifyEvent[] = [];

  #negotiatedTarget?: PeerDescriptor;
  #rpcDispatcher?: RpcDispatcher;
  #negotiatedCapabilities: string[] = [];
  #handshakeTimeout?: unknown;
  #flushScheduled = false;
  #overflowed = false;

  constructor(options: ServerSessionOptions) {
    this.#options = options;
    const clock = options.clock ?? systemProtocolClock;
    this.#timers = resolveTimers(options.timers);
    this.#sender = new PrioritizedMessageSender(options.send);
    this.#rpc = new RpcClient({
      createMessage: options.createMessage,
      send: options.send,
      defaultTimeoutMs: options.rpcTimeoutMs,
      timers: this.#timers,
    });
    this.#heartbeat = new ServerHeartbeat({
      clock,
      timers: this.#timers,
      intervalMs: options.heartbeat.intervalMs,
      timeoutMs: options.heartbeat.timeoutMs,
      isReady: () => this.state === "ready",
      send: () =>
        this.#sendControl(
          options.createMessage(
            "heartbeat",
            {
              sessionId: this.sessionId,
              sentAt: clock.isoNow(),
            },
            { target: this.peer },
          ),
        ),
      timeout: async () => {
        await options.diagnostics?.publish({ type: "heartbeat" });
        await this.shutdown("idle_timeout", "Protocol heartbeat timed out");
      },
    });
    this.#handshakeTimeout = this.#timers.setTimeout(() => {
      if (this.state === "awaiting_hello" || this.state === "awaiting_ready") {
        void this.shutdown("idle_timeout", "Protocol handshake timed out");
      }
    }, options.heartbeat.timeoutMs);
  }

  request<M extends OperationName>(
    method: M,
    params: OperationParams<M>,
    options: Pick<
      ProtocolRequestData,
      "idempotencyKey" | "timeoutMs" | "expect"
    > &
      Pick<
        import("./messages.js").MessageFactoryOptions,
        "correlationId" | "causationId" | "traceId"
      > = {},
  ): Promise<OperationResult<M>> {
    if (this.state !== "ready") {
      throw new SessionStateError("RPC requests require a ready session");
    }
    return this.#rpc.request(method, params, { ...options, target: this.peer });
  }

  async receive(message: ProtocolV1Message): Promise<void> {
    this.#heartbeat.received();
    if (this.state === "awaiting_hello") {
      await this.#receiveHello(message);
      return;
    }
    if (!(await this.#hasNegotiatedPeers(message))) {
      await this.fail(
        "INVALID_MESSAGE",
        "Message source or target does not match the negotiated session peers",
      );
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
      if (this.#handshakeTimeout !== undefined)
        this.#timers.clearTimeout(this.#handshakeTimeout);
      this.#handshakeTimeout = undefined;
      this.#heartbeat.start();
      await this.#options.onReady?.(message);
      return;
    }
    if (this.state !== "ready") {
      throw new SessionStateError(
        `Cannot receive ${message.kind} while ${this.state}`,
      );
    }

    if (message.kind === "stream.subscription.set") {
      await this.#setSubscriptions(message);
      return;
    }
    if (message.kind === "goodbye") {
      if (message.data.sessionId && message.data.sessionId !== this.sessionId) {
        await this.fail("INVALID_MESSAGE", "Goodbye session id mismatch");
        return;
      }
      this.#finalize(new Error("Protocol peer closed the session"));
      return;
    }
    if (this.#rpc.handle(message)) return;
    if (message.kind === "event.batch" && this.#options.onEventBatch) {
      await this.#options.onEventBatch(message);
      return;
    }
    if (message.kind === "event.notify" && this.#options.onNotify) {
      await this.#options.onNotify(message.data.events, message);
      return;
    }
    if (message.kind === "request" && this.#rpcDispatcher) {
      const result = await this.#rpcDispatcher.dispatch(message);
      await this.#sendControl(
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
    if (message.kind === "heartbeat") {
      if (message.data.sessionId !== this.sessionId) {
        await this.fail("INVALID_MESSAGE", "Heartbeat session id mismatch");
      }
      return;
    }
    await this.#options.onMessage?.(message);
  }

  async publish(stream: string, event: EventEnvelope): Promise<void> {
    if (this.state !== "ready" || !this.#activeStreams.has(stream)) return;
    const queues = this.#replaying.has(stream)
      ? this.#replayBufferedLive
      : this.#pendingLive;
    const queue = queues.get(stream) ?? [];
    queue.push(event);
    queues.set(stream, queue);
    if (!this.#checkBufferLimit()) return;
    this.#scheduleFlush();
  }

  removeStream(stream: string): void {
    this.#activeStreams.delete(stream);
    this.#streamStates.delete(stream);
    this.#replaying.delete(stream);
    this.#pendingLive.delete(stream);
    this.#replayBufferedLive.delete(stream);
  }

  dispose(): void {
    if (this.state === "closed") return;
    this.#finalize(new Error("Protocol session disposed"));
  }

  async notify(event: NotifyEvent): Promise<void> {
    if (this.state !== "ready") return;
    const definition = publicEventDefinition(event.type);
    if (!definition || definition.delivery !== "ephemeral") {
      throw new Error(`Event ${event.type} is not ephemeral`);
    }
    if (definition.coalescing === "latest_by_scope") {
      const key = notifyScopeKey(event, definition.scope);
      const index = this.#notifyQueue.findIndex(
        (queued) => notifyScopeKey(queued, definition.scope) === key,
      );
      if (index >= 0) this.#notifyQueue.splice(index, 1);
    }
    this.#notifyQueue.push(event);
    const limit = this.#options.notifyQueueLimit ?? 256;
    while (this.#notifyQueue.length > limit) this.#notifyQueue.shift();
    if (!this.#checkBufferLimit()) return;
    this.#scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.state !== "ready" || this.#overflowed) return;
    this.#flushScheduled = false;
    for (const [stream, events] of [...this.#pendingLive]) {
      this.#pendingLive.delete(stream);
      if (!this.#activeStreams.has(stream) || this.#replaying.has(stream))
        continue;
      await this.#sendEvents(stream, events, "live", "live");
    }
    if (this.#notifyQueue.length > 0) {
      const events = this.#notifyQueue.splice(0);
      await this.#sender.send(
        this.#options.createMessage(
          "event.notify",
          { events },
          {
            target: this.peer,
          },
        ),
        "live",
      );
    }
  }

  async fail(code: ProtocolErrorData["code"], message: string): Promise<void> {
    await this.#sendControl(
      this.#options.createMessage(
        "error",
        {
          code,
          message,
          retryable: false,
        },
        { target: this.peer },
      ),
    );
  }

  async shutdown(
    reason: GoodbyeData["reason"] = "server_shutdown",
    message?: string,
  ): Promise<void> {
    if (this.state === "closed" || this.state === "closing") return;
    this.state = "closing";
    this.#heartbeat.stop();
    if (this.#handshakeTimeout !== undefined)
      this.#timers.clearTimeout(this.#handshakeTimeout);
    this.#handshakeTimeout = undefined;
    try {
      if (this.sessionId) {
        await this.#sendControl(
          this.#options.createMessage(
            "goodbye",
            {
              sessionId: this.sessionId,
              reason,
              message,
            },
            { target: this.peer },
          ),
        );
      }
    } finally {
      this.#finalize(new Error(message ?? reason));
    }
  }

  async #receiveHello(message: ProtocolV1Message): Promise<void> {
    if (message.kind !== "hello") {
      throw new SessionStateError("hello must be the first client message");
    }
    this.peer = message.source;
    this.#negotiatedTarget = message.target;
    if (
      this.#options.allowedPeerRoles &&
      !this.#options.allowedPeerRoles.includes(message.source.role)
    ) {
      await this.fail(
        "AUTH_FORBIDDEN",
        `Peer role ${message.source.role} is not allowed`,
      );
      return;
    }
    const serverCapabilities = new Set(this.#options.capabilities ?? []);
    if (
      !serverCapabilities.has(STREAM_SUBSCRIPTION_CAPABILITY) ||
      !message.data.capabilities.includes(STREAM_SUBSCRIPTION_CAPABILITY)
    ) {
      await this.fail(
        "CAPABILITY_REQUIRED",
        `${STREAM_SUBSCRIPTION_CAPABILITY} is required`,
      );
      return;
    }
    const unsupportedRequired = (
      message.data.requiredCapabilities ?? []
    ).filter((capability) => !serverCapabilities.has(capability));
    if (unsupportedRequired.length > 0) {
      await this.fail(
        "CAPABILITY_REQUIRED",
        `Unsupported required capabilities: ${unsupportedRequired.join(", ")}`,
      );
      return;
    }
    this.#negotiatedCapabilities = [...serverCapabilities].filter(
      (capability) => message.data.capabilities.includes(capability),
    );
    this.#rpcDispatcher =
      typeof this.#options.rpcDispatcher === "function"
        ? this.#options.rpcDispatcher({
            capabilities: this.#negotiatedCapabilities,
            peer: message.source,
          })
        : this.#options.rpcDispatcher;
    this.sessionId = this.#options.sessionId();
    this.state = "awaiting_ready";
    await this.#sendControl(
      this.#options.createMessage(
        "welcome",
        {
          sessionId: this.sessionId,
          acceptingPeer: this.#options.acceptingPeer,
          acceptedVersion: 1,
          capabilities: this.#negotiatedCapabilities,
          encoding: "json",
          limits: this.#options.limits,
          heartbeat: this.#options.heartbeat,
        },
        { target: message.source },
      ),
    );
  }

  async #setSubscriptions(
    message: ProtocolV1Message & { kind: "stream.subscription.set" },
  ): Promise<void> {
    if (message.data.sessionId !== this.sessionId) {
      await this.fail("INVALID_MESSAGE", "Subscription session id mismatch");
      return;
    }
    const subscriptions = this.#options.subscriptions;
    if (!subscriptions || !this.#options.readStream) {
      await this.fail(
        "CAPABILITY_REQUIRED",
        "Stream subscriptions are unavailable",
      );
      return;
    }
    const decision = await subscriptions.resolve(
      message.data.streams,
      message.source,
    );
    const statesByName = new Map(
      decision.streams.map((state) => [state.stream, state]),
    );
    if (!decision.accepted) {
      await this.#sendSubscriptionUpdated(
        message,
        false,
        [],
        decision.reason ?? "Subscription rejected",
      );
      return;
    }

    // Streams the resolver could not produce (deleted/unknown) degrade
    // per-stream to "unavailable" instead of rejecting the whole set: one
    // stale conversation stream must never disable live delivery for the
    // remaining streams.
    const subscribed: SubscribedStreamState[] = message.data.streams.map(
      (cursor) => {
        const state = statesByName.get(cursor.stream);
        if (!state) {
          return {
            stream: cursor.stream,
            latestSeq: 0,
            earliestAvailableSeq: 0,
            mode: "unavailable" as const,
          };
        }
        return { ...state, mode: subscriptionMode(cursor, state) };
      },
    );
    const acceptedCursors = message.data.streams.filter((cursor) => {
      const mode = subscribed.find(
        (state) => state.stream === cursor.stream,
      )?.mode;
      return mode !== "snapshot_required" && mode !== "unavailable";
    });
    const nextActive = new Set(acceptedCursors.map((cursor) => cursor.stream));
    this.#activeStreams.clear();
    this.#streamStates.clear();
    for (const state of decision.streams) {
      if (!nextActive.has(state.stream)) continue;
      this.#activeStreams.add(state.stream);
      this.#streamStates.set(state.stream, state);
    }
    for (const stream of [...this.#pendingLive.keys()]) {
      if (!nextActive.has(stream)) this.#pendingLive.delete(stream);
    }
    for (const cursor of acceptedCursors) {
      const mode = subscribed.find(
        (state) => state.stream === cursor.stream,
      )?.mode;
      if (mode === "replay") this.#replaying.add(cursor.stream);
    }

    await this.#sendSubscriptionUpdated(message, true, subscribed);
    await subscriptions.activate?.(
      acceptedCursors,
      decision.streams.filter((state) => nextActive.has(state.stream)),
    );

    for (const cursor of acceptedCursors) {
      const state = statesByName.get(cursor.stream) as StreamState;
      if (cursor.processedSeq < state.latestSeq) {
        await this.#replayStream(cursor, state.latestSeq);
      }
      this.#replaying.delete(cursor.stream);
      const buffered = this.#replayBufferedLive.get(cursor.stream) ?? [];
      this.#replayBufferedLive.delete(cursor.stream);
      const fresh = buffered.filter((event) => event.seq > state.latestSeq);
      if (fresh.length > 0)
        await this.#sendEvents(cursor.stream, fresh, "live", "live");
    }
    await this.flush();
  }

  async #replayStream(cursor: StreamCursor, throughSeq: number): Promise<void> {
    const readStream = this.#options.readStream as NonNullable<
      ServerSessionOptions["readStream"]
    >;
    let nextSeq = cursor.processedSeq + 1;
    while (nextSeq <= throughSeq) {
      const read = await readStream(
        cursor.stream,
        nextSeq,
        this.#options.limits.maxBatchEvents,
      );
      const events = read.events.filter((event) => event.seq <= throughSeq);
      if (events.length === 0 || events[0]?.seq !== nextSeq) {
        await this.#overflow(`Replay continuity failed for ${cursor.stream}`);
        return;
      }
      await this.#sendEvents(cursor.stream, events, "replay", "replay");
      nextSeq = (events.at(-1) as EventEnvelope).seq + 1;
    }
  }

  async #sendEvents(
    stream: string,
    events: readonly EventEnvelope[],
    reason: "replay" | "live",
    priority: "replay" | "live",
  ): Promise<void> {
    for (const chunk of chunkEvents(
      events,
      this.#options.limits.maxBatchEvents,
      this.#options.limits.maxBatchBytes,
    )) {
      const batch = buildEventBatch(chunk, { stream, reason });
      await this.#sender.send(
        this.#options.createMessage("event.batch", batch, {
          target: this.peer,
        }),
        priority,
      );
    }
  }

  async #sendSubscriptionUpdated(
    request: ProtocolV1Message & { kind: "stream.subscription.set" },
    accepted: boolean,
    streams: readonly SubscribedStreamState[],
    reason?: string,
  ): Promise<void> {
    await this.#sendControl(
      this.#options.createMessage(
        "stream.subscription.updated",
        {
          sessionId: this.sessionId as string,
          subscriptionId: request.data.subscriptionId,
          accepted,
          streams: [...streams],
          reason,
        },
        { target: request.source, correlationId: request.id },
      ),
    );
  }

  #scheduleFlush(): void {
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    queueMicrotask(
      () =>
        void this.flush().catch(() => this.#overflow("Event delivery failed")),
    );
  }

  #checkBufferLimit(): boolean {
    const events = [
      ...this.#pendingLive.values(),
      ...this.#replayBufferedLive.values(),
    ].reduce((count, queue) => count + queue.length, this.#notifyQueue.length);
    const bytes = [
      ...this.#pendingLive.values(),
      ...this.#replayBufferedLive.values(),
    ]
      .flat()
      .reduce(
        (total, event) => total + estimateProtocolMessageBytes("event", event),
        this.#notifyQueue.reduce(
          (total, event) =>
            total + estimateProtocolMessageBytes("notify", event),
          0,
        ),
      );
    if (
      events > (this.#options.maxBufferedEvents ?? 10_000) ||
      bytes > (this.#options.maxBufferedBytes ?? 16 * 1_024 * 1_024)
    ) {
      void this.#overflow("Outgoing event buffer exceeded");
      return false;
    }
    return true;
  }

  async #overflow(message: string): Promise<void> {
    if (this.#overflowed) return;
    this.#overflowed = true;
    await this.#options.diagnostics?.publish({ type: "queue" });
    if (this.#options.close) {
      await this.#options.close(
        RESYNC_CLOSE_CODE,
        RESYNC_REQUIRED_CLOSE_REASON,
      );
      this.#finalize(new Error(message));
      return;
    }
    await this.shutdown("resync_required", message);
  }

  #sendControl(message: NerveMessage): Promise<void> {
    return this.#sender.send(message, "control");
  }

  async #hasNegotiatedPeers(message: ProtocolV1Message): Promise<boolean> {
    if (!this.peer || !this.#negotiatedTarget) return false;
    if (!samePeer(message.source, this.peer)) return false;
    const negotiatedTargetAllowed =
      samePeer(message.target, this.#options.acceptingPeer) &&
      matchesAddressedPeer(this.#negotiatedTarget, message.target);
    if (!this.#options.authorizeTarget) return negotiatedTargetAllowed;
    return this.#options.authorizeTarget(message, {
      peer: this.peer,
      negotiatedTarget: this.#negotiatedTarget,
      acceptingPeer: this.#options.acceptingPeer,
    });
  }

  #finalize(error: Error): void {
    this.state = "closed";
    this.#heartbeat.stop();
    this.#rpc.close(error);
    this.#sender.close(error);
    this.#activeStreams.clear();
    this.#streamStates.clear();
    this.#pendingLive.clear();
    this.#replayBufferedLive.clear();
    this.#notifyQueue.splice(0);
  }
}

function subscriptionMode(
  cursor: StreamCursor,
  state: StreamState,
): SubscribedStreamState["mode"] {
  if (cursor.processedSeq > state.latestSeq) return "snapshot_required";
  if (cursor.processedSeq + 1 < state.earliestAvailableSeq)
    return "snapshot_required";
  return cursor.processedSeq < state.latestSeq ? "replay" : "live";
}

function notifyScopeKey(event: NotifyEvent, scope: readonly string[]): string {
  return `${event.type}:${scope.map((path) => JSON.stringify(readPath(event.data, path))).join(":")}`;
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
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

function resolveTimers(timers: ServerSessionOptions["timers"]) {
  return timers ?? systemProtocolTimers;
}
