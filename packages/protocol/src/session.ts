/* eslint-disable max-lines -- Shared server lifecycle remains one cohesive state machine. */
import type {
  EventEnvelope,
  HelloData,
  NerveMessage,
  OperationName,
  OperationParams,
  OperationResult,
  PeerDescriptor,
  ProtocolErrorData,
  ProtocolRequestData,
  ProtocolV1Message,
  ReplayUnavailableData,
  StreamState,
} from "@nervekit/contracts";
import { buildEventBatch, chunkEvents } from "./event-batch.js";
import type { ProtocolIdSource, ProtocolTimers } from "./ports.js";
import { RpcClient, type RpcDispatcher } from "./rpc.js";
import {
  systemProtocolClock,
  systemProtocolIds,
  systemProtocolTimers,
} from "./runtime.js";
import { PrioritizedMessageSender } from "./priority-sender.js";
import { sendReplayUnavailable } from "./replay-unavailable.js";
import { ProtocolSessionQueue } from "./session-queue.js";
import { ServerHeartbeat } from "./server-heartbeat.js";
import { SessionStateError } from "./client-session.js";
import type {
  ServerSessionOptions,
  ServerSessionState,
  SessionResumeDecision,
} from "./server-session-types.js";
export class ProtocolServerSession {
  state: ServerSessionState = "awaiting_hello";
  sessionId?: string;
  peer?: PeerDescriptor;
  readonly #options: ServerSessionOptions;
  readonly #heartbeat: ServerHeartbeat;
  readonly #timers: ProtocolTimers;
  readonly #ids: ProtocolIdSource;
  readonly #sender: PrioritizedMessageSender;
  readonly #rpc: RpcClient;
  readonly #queues = new Map<string, ProtocolSessionQueue>();
  readonly #replaying = new Map<string, Set<string>>();
  readonly #previousDurableSeq = new Map<string, number>();
  readonly #processedSeq = new Map<string, number>();
  readonly #unackedDurableSeqs = new Map<string, number[]>();
  #hello?: HelloData;
  #negotiatedTarget?: PeerDescriptor;
  #resumeDecision?: SessionResumeDecision;
  #rpcDispatcher?: RpcDispatcher;
  #handshakeTimeout?: unknown;
  #flushing = false;
  #liveDeliveryEnabled = false;

  constructor(options: ServerSessionOptions) {
    this.#options = options;
    const clock = options.clock ?? systemProtocolClock;
    this.#timers = options.timers ?? systemProtocolTimers;
    this.#ids = options.ids ?? systemProtocolIds;
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
              processed: [...this.#processedSeq].map(
                ([stream, processedSeq]) => ({ stream, processedSeq }),
              ),
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
      if (this.state === "awaiting_hello" || this.state === "awaiting_ready")
        void this.shutdown("idle_timeout", "Protocol handshake timed out");
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
    if (this.state !== "ready")
      throw new SessionStateError("RPC requests require a ready session");
    return this.#rpc.request(method, params, options);
  }

  async receive(message: ProtocolV1Message): Promise<void> {
    this.#heartbeat.received();
    if (this.state === "awaiting_hello") {
      if (message.kind !== "hello") {
        throw new SessionStateError("hello must be the first client message");
      }
      this.peer = message.source;
      this.#negotiatedTarget = message.target;
      this.#hello = message.data;
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
      if (message.source.role === "sandbox_agent" && !message.source.id) {
        await this.fail(
          "INVALID_MESSAGE",
          "Sandbox agent peers require a nonempty id",
        );
        return;
      }
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
      this.#resumeDecision = decision;
      if (decision.accepted) {
        for (const cursor of message.data.resume?.streams ?? []) {
          const state = this.#options
            .streams()
            .find((stream) => stream.stream === cursor.stream);
          if (!state || cursor.processedSeq > state.latestSeq) continue;
          this.#processedSeq.set(cursor.stream, cursor.processedSeq);
          this.#previousDurableSeq.set(cursor.stream, cursor.processedSeq);
        }
      }
      const capabilities = [...(this.#options.capabilities ?? [])].filter(
        (capability) => message.data.capabilities.includes(capability),
      );
      this.#rpcDispatcher =
        typeof this.#options.rpcDispatcher === "function"
          ? this.#options.rpcDispatcher({
              capabilities,
              peer: message.source,
            })
          : this.#options.rpcDispatcher;
      this.sessionId = this.#options.sessionId();
      await this.#sendControl(
        this.#options.createMessage(
          "welcome",
          {
            sessionId: this.sessionId,
            acceptingPeer: this.#options.acceptingPeer,
            acceptedVersion: 1,
            capabilities,
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
      if (this.#resumeDecision?.accepted) {
        for (const cursor of message.data.streams ?? []) {
          const stream = this.#options
            .streams()
            .find((candidate) => candidate.stream === cursor.stream);
          if (!stream || cursor.processedSeq > stream.latestSeq) {
            await this.fail("INVALID_MESSAGE", "Ready cursor was not accepted");
            return;
          }
          this.#processedSeq.set(cursor.stream, cursor.processedSeq);
          this.#previousDurableSeq.set(cursor.stream, cursor.processedSeq);
        }
      }
      this.state = "ready";
      if (this.#handshakeTimeout !== undefined)
        this.#timers.clearTimeout(this.#handshakeTimeout);
      this.#handshakeTimeout = undefined;
      this.#heartbeat.start();
      await this.#options.onReady?.(message);
      if (
        this.#resumeDecision?.mode === "replay" &&
        this.#hello?.resume?.streams &&
        this.#options.replaySource
      ) {
        const streams = this.#hello.resume.streams
          .map((cursor) => ({
            stream: cursor.stream,
            fromSeq: cursor.processedSeq + 1,
          }))
          .filter((cursor) => {
            const state = this.#options
              .streams()
              .find((stream) => stream.stream === cursor.stream);
            return state && cursor.fromSeq <= state.latestSeq;
          });
        if (streams.length > 0) {
          await this.#replay(
            this.#options.createMessage(
              "replay.request",
              {
                sessionId: this.sessionId as string,
                replayId: this.#ids.create("rpl"),
                streams,
                reason: "resume",
              },
              { source: message.source, target: this.#options.acceptingPeer },
            ) as ProtocolV1Message & { kind: "replay.request" },
          );
        }
      }
      this.#liveDeliveryEnabled = true;
      await this.#flush();
      return;
    }
    if (this.state !== "ready") {
      throw new SessionStateError(
        `Cannot receive ${message.kind} while ${this.state}`,
      );
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
      const applied = await this.#options.onEventBatch(message);
      await this.#sendControl(
        this.#options.createMessage(
          "event.ack",
          {
            sessionId: this.sessionId as string,
            ackId: message.data.batchId,
            streams: [...applied.streams],
            stats:
              applied.appliedEvents === undefined
                ? undefined
                : { appliedEvents: applied.appliedEvents },
          },
          { target: message.source, correlationId: message.id },
        ),
      );
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
    if (message.kind === "event.ack") {
      if (message.data.sessionId !== this.sessionId) {
        await this.fail("INVALID_MESSAGE", "ACK session id mismatch");
        return;
      }
      for (const cursor of message.data.streams) {
        const highestSent = this.#previousDurableSeq.get(cursor.stream);
        if (highestSent === undefined || cursor.processedSeq > highestSent) {
          await this.fail(
            "INVALID_MESSAGE",
            `ACK exceeds sent durable progress for ${cursor.stream}`,
          );
          return;
        }
        this.#processedSeq.set(
          cursor.stream,
          Math.max(
            this.#processedSeq.get(cursor.stream) ?? 0,
            cursor.processedSeq,
          ),
        );
        this.#unackedDurableSeqs.set(
          cursor.stream,
          (this.#unackedDurableSeqs.get(cursor.stream) ?? []).filter(
            (seq) => seq > cursor.processedSeq,
          ),
        );
      }
      await this.#options.onAck?.(message);
      return;
    }
    if (message.kind === "replay.request") {
      if (message.data.sessionId !== this.sessionId) {
        await this.fail("INVALID_MESSAGE", "Replay session id mismatch");
        return;
      }
      if (this.#options.replaySource) await this.#replay(message);
      else await this.#options.onReplayRequest?.(message);
      return;
    }
    if (message.kind === "heartbeat") {
      if (message.data.sessionId !== this.sessionId)
        await this.fail("INVALID_MESSAGE", "Heartbeat session id mismatch");
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
      } else if (
        request.fromSeq > state.latestSeq + 1 ||
        (request.toSeq !== undefined && request.toSeq > state.latestSeq)
      ) {
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
      await this.#sendReplay(
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
    for (const range of ranges) {
      const replayIds = this.#replaying.get(range.stream) ?? new Set();
      replayIds.add(message.data.replayId);
      this.#replaying.set(range.stream, replayIds);
    }
    const completed = [];
    try {
      await this.#sendReplay(
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
      for (const range of ranges) {
        let nextSeq = range.fromSeq;
        let complete = nextSeq > range.toSeq;
        let previousDurableSeq = Math.max(0, range.fromSeq - 1);
        let sentEvents = 0;
        let sentDurableEvents = 0;
        while (!complete) {
          const read = await source.read({
            stream: range.stream,
            fromSeq: nextSeq,
            toSeq: range.toSeq,
            limit: this.#options.limits.maxBatchEvents,
          });
          if (!read.available) {
            await this.#sendReplayUnavailable(
              message,
              range,
              read.reason,
              read.earliestAvailableSeq,
              read.latestSeq,
              read.recovery,
            );
            return;
          }
          const events = [...read.events];
          if (
            events.some(
              (event, index) =>
                event.seq < nextSeq ||
                event.seq > range.toSeq ||
                (index > 0 && event.seq <= (events[index - 1]?.seq ?? 0)),
            )
          ) {
            await this.#sendReplayUnavailable(
              message,
              range,
              "storage_unavailable",
            );
            return;
          }
          if (events.length === 0 && !read.complete) {
            await this.#sendReplayUnavailable(
              message,
              range,
              "storage_unavailable",
            );
            return;
          }
          if (sentEvents === 0 && read.previousDurableSeq !== undefined)
            previousDurableSeq = read.previousDurableSeq;
          for (const batch of chunkEvents(
            events,
            this.#options.limits.maxBatchEvents,
            this.#options.limits.maxBatchBytes,
          )) {
            const durable = batch.filter(
              (event) => event.durability === "durable",
            );
            await this.#sendReplay(
              this.#options.createMessage(
                "event.batch",
                buildEventBatch(batch, {
                  stream: range.stream,
                  reason: "replay",
                  previousDurableSeq,
                  replay: {
                    replayId: message.data.replayId,
                    fromSeq: batch[0]?.seq ?? nextSeq,
                    toSeq: batch.at(-1)?.seq ?? nextSeq,
                    complete:
                      read.complete && batch.at(-1)?.seq === events.at(-1)?.seq,
                  },
                }),
                { target: message.source },
              ),
            );
            previousDurableSeq = durable.at(-1)?.seq ?? previousDurableSeq;
            if (durable.length > 0) {
              this.#previousDurableSeq.set(range.stream, previousDurableSeq);
              this.#trackUnacked(range.stream, durable);
            }
            sentEvents += batch.length;
            sentDurableEvents += durable.length;
          }
          complete = read.complete;
          const inferredNext = events.at(-1)
            ? (events.at(-1) as EventEnvelope).seq + 1
            : nextSeq;
          const candidate = read.nextSeq ?? inferredNext;
          if (!complete && candidate <= nextSeq) {
            await this.#sendReplayUnavailable(
              message,
              range,
              "storage_unavailable",
            );
            return;
          }
          nextSeq = candidate;
        }
        completed.push({
          stream: range.stream,
          fromSeq: range.fromSeq,
          toSeq: range.toSeq,
          latestSeq: range.latestSeq,
          durableCompleteThroughSeq: previousDurableSeq,
          sentEvents,
          sentDurableEvents,
          sentTransientEvents: sentEvents - sentDurableEvents,
        });
      }
      await this.#sendReplay(
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
    } finally {
      for (const range of ranges) {
        const replayIds = this.#replaying.get(range.stream);
        replayIds?.delete(message.data.replayId);
        if (replayIds?.size === 0) this.#replaying.delete(range.stream);
      }
      await this.#flush();
    }
  }

  async publish(
    stream: string,
    events: EventEnvelope | readonly EventEnvelope[],
  ): Promise<void> {
    if (this.state === "closing" || this.state === "closed")
      throw new SessionStateError("Live events require an open session");
    const queue = this.#queues.get(stream) ?? new ProtocolSessionQueue();
    this.#queues.set(stream, queue);
    for (const event of Array.isArray(events) ? events : [events])
      queue.enqueueLive(event);

    const before = queue.stats();
    queue.coalesceTransientOverflow(this.#options.limits.maxBatchEvents);
    queue.dropTransientOverflow(this.#options.limits.maxBatchEvents);
    const after = queue.stats();
    if (
      after.droppedTransientCount > before.droppedTransientCount ||
      after.coalescedTransientCount > before.coalescedTransientCount
    ) {
      await this.#sendFlow(stream, "degraded", "transient_events_dropped", {
        type: "pause_transient",
      });
    }
    const unacked = this.#unackedDurableSeqs.get(stream)?.length ?? 0;
    const maximumQueueBytes =
      this.#options.limits.maxBatchBytes *
      this.#options.limits.maxInflightBatches;
    if (
      after.durableCount + unacked >
        this.#options.limits.maxUnackedDurableEvents ||
      after.queuedBytes > maximumQueueBytes
    ) {
      await this.#sendFlow(stream, "resync_required", "queue_limit_exceeded", {
        type: "close",
      });
      await this.shutdown("other", "Protocol durable queue limit exceeded");
      return;
    }
    await this.#flush();
  }

  dispose(): void {
    this.#finalize(new Error("Protocol server session disposed"));
  }

  async shutdown(
    reason:
      | "server_shutdown"
      | "idle_timeout"
      | "protocol_error"
      | "other" = "server_shutdown",
    message?: string,
  ): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closing";
    this.#liveDeliveryEnabled = false;
    this.#heartbeat.stop();
    if (this.#handshakeTimeout !== undefined)
      this.#timers.clearTimeout(this.#handshakeTimeout);
    this.#handshakeTimeout = undefined;
    await this.#sendControl(
      this.#options.createMessage(
        "goodbye",
        { sessionId: this.sessionId, reason, message },
        { target: this.peer },
      ),
    );
    this.#finalize(new Error("Protocol server session closed"));
  }

  async #hasNegotiatedPeers(message: ProtocolV1Message): Promise<boolean> {
    if (
      this.peer === undefined ||
      this.#negotiatedTarget === undefined ||
      !samePeer(message.source, this.peer)
    )
      return false;
    if (!this.#options.authorizeTarget)
      return samePeer(message.target, this.#negotiatedTarget);
    return this.#options.authorizeTarget(message, {
      peer: this.peer,
      negotiatedTarget: this.#negotiatedTarget,
      acceptingPeer: this.#options.acceptingPeer,
    });
  }

  #finalize(error: Error): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.#liveDeliveryEnabled = false;
    this.#heartbeat.stop();
    this.#rpc.disconnect(error);
    if (this.#handshakeTimeout !== undefined)
      this.#timers.clearTimeout(this.#handshakeTimeout);
    this.#handshakeTimeout = undefined;
    this.#replaying.clear();
    for (const queue of this.#queues.values()) queue.clear();
    this.#queues.clear();
    this.#sender.close();
  }

  async #flush(): Promise<void> {
    if (this.#flushing || this.state !== "ready" || !this.#liveDeliveryEnabled)
      return;
    this.#flushing = true;
    try {
      for (const [stream, queue] of this.#queues) {
        if ((this.#replaying.get(stream)?.size ?? 0) > 0) continue;
        let events = queue.shiftDurable(this.#options.limits.maxBatchEvents);
        if (events.length === 0)
          events = queue.shiftTransient(this.#options.limits.maxBatchEvents);
        while (events.length > 0 && this.state === "ready") {
          for (const batch of chunkEvents(
            events,
            this.#options.limits.maxBatchEvents,
            this.#options.limits.maxBatchBytes,
          )) {
            const previousDurableSeq =
              this.#previousDurableSeq.get(stream) ??
              this.#processedSeq.get(stream) ??
              0;
            await this.#sendLive(
              this.#options.createMessage(
                "event.batch",
                buildEventBatch(batch, {
                  stream,
                  reason: "live",
                  previousDurableSeq,
                }),
                { target: this.peer },
              ),
            );
            const durable = batch.filter(
              (event) => event.durability === "durable",
            );
            if (durable.length > 0) {
              this.#previousDurableSeq.set(
                stream,
                durable.at(-1)?.seq ?? previousDurableSeq,
              );
              this.#trackUnacked(stream, durable);
              const dropped = queue.dropTransientThrough(
                durable.at(-1)?.seq ?? previousDurableSeq,
              );
              if (dropped > 0)
                await this.#sendFlow(
                  stream,
                  "degraded",
                  "transient_events_dropped",
                  { type: "pause_transient" },
                );
            }
          }
          events = queue.shiftDurable(this.#options.limits.maxBatchEvents);
          if (events.length === 0)
            events = queue.shiftTransient(this.#options.limits.maxBatchEvents);
        }
      }
    } finally {
      this.#flushing = false;
    }
  }

  #sendControl(message: NerveMessage): Promise<void> {
    return this.#sender.send(message, "control");
  }

  #sendReplay(message: NerveMessage): Promise<void> {
    return this.#sender.send(message, "replay");
  }

  #sendLive(message: NerveMessage): Promise<void> {
    return this.#sender.send(message, "live");
  }

  #trackUnacked(stream: string, events: readonly EventEnvelope[]): void {
    const processedSeq = this.#processedSeq.get(stream) ?? 0;
    const pending = this.#unackedDurableSeqs.get(stream) ?? [];
    const seen = new Set(pending);
    for (const event of events) {
      if (
        event.durability === "durable" &&
        event.seq > processedSeq &&
        !seen.has(event.seq)
      ) {
        pending.push(event.seq);
        seen.add(event.seq);
      }
    }
    pending.sort((left, right) => left - right);
    this.#unackedDurableSeqs.set(stream, pending);
  }

  async #sendFlow(
    stream: string,
    mode: "degraded" | "resync_required",
    reason: "transient_events_dropped" | "queue_limit_exceeded",
    action: { type: "pause_transient" | "close" },
  ): Promise<void> {
    const stats = this.#queues.get(stream)?.stats();
    await this.#sendControl(
      this.#options.createMessage(
        "flow.update",
        {
          sessionId: this.sessionId as string,
          scope: { stream },
          mode,
          reason,
          stats: {
            serverQueueEvents:
              (stats?.durableCount ?? 0) + (stats?.transientCount ?? 0),
            serverQueueBytes: stats?.queuedBytes ?? 0,
            droppedTransientEvents: stats?.droppedTransientCount ?? 0,
            coalescedTransientEvents: stats?.coalescedTransientCount ?? 0,
            unackedDurableEvents:
              this.#unackedDurableSeqs.get(stream)?.length ?? 0,
          },
          action,
        },
        { target: this.peer },
      ),
    );
    await this.#options.diagnostics?.publish({
      type: "flow",
      stream,
      count: stats?.durableCount,
      bytes: stats?.queuedBytes,
    });
  }

  async #sendReplayUnavailable(
    message: ProtocolV1Message & { kind: "replay.request" },
    range: { stream: string; fromSeq: number; latestSeq: number },
    reason: ReplayUnavailableData["streams"][number]["reason"],
    earliestAvailableSeq?: number,
    latestSeq = range.latestSeq,
    recovery: ReplayUnavailableData["recovery"] = {
      action: "load_snapshot",
    },
  ): Promise<void> {
    await sendReplayUnavailable({
      createMessage: this.#options.createMessage,
      send: (outbound) => this.#sendReplay(outbound),
      sessionId: this.sessionId as string,
      request: message,
      range,
      reason,
      earliestAvailableSeq,
      latestSeq,
      recovery,
    });
  }

  async fail(code: ProtocolErrorData["code"], message: string): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closing";
    this.#heartbeat.stop();
    if (this.#handshakeTimeout !== undefined)
      this.#timers.clearTimeout(this.#handshakeTimeout);
    this.#handshakeTimeout = undefined;
    await this.#sendControl(
      this.#options.createMessage("error", {
        code,
        message,
        retryable: false,
        close: true,
      }),
    );
    this.#finalize(new Error(message));
  }
}

function samePeer(left: PeerDescriptor, right: PeerDescriptor): boolean {
  return (
    left.role === right.role &&
    left.id === right.id &&
    left.instanceId === right.instanceId &&
    left.name === right.name
  );
}
