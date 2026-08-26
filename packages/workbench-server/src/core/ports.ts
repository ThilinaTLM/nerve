export interface ClockPort {
  now(): Date;
}

export interface IdPort {
  next(): string;
}

export interface DiagnosticPort {
  debug(message: string, data?: Readonly<Record<string, unknown>>): void;
  warn(message: string, data?: Readonly<Record<string, unknown>>): void;
  error(message: string, data?: Readonly<Record<string, unknown>>): void;
}

export interface DomainEventIntent<
  TName extends string = string,
  TData = unknown,
> {
  readonly type: TName;
  readonly data: TData;
  readonly delivery: "sequenced" | "ephemeral";
  readonly occurredAt: string;
}

export interface DomainEventPublisherPort {
  publish(event: DomainEventIntent): Promise<void>;
}

export type PerformanceMetricName =
  | "rpc.handler"
  | "rpc.error"
  | "event.durable"
  | "event.ephemeral"
  | "event.listenerDelivery"
  | "event.publishFailure"
  | "event.streamFlush"
  | "event.streamFlushEvents"
  | "event.streamCompaction"
  | "event.streamCompactionBytesBefore"
  | "event.streamCompactionBytesAfter"
  | "event.fsync"
  | "websocket.sessionOpened"
  | "websocket.sessionClosed"
  | "websocket.sequencedDelivery"
  | "websocket.notifyDelivery"
  | "task.outputChunk"
  | "task.outputBytes"
  | "task.outputLine"
  | "task.outputCapture"
  | "task.outputPublication"
  | "git.watcherCreated"
  | "git.watcherEvicted"
  | "git.filesystemEvent"
  | "git.invalidation"
  | "git.metadataInvalidation"
  | "conversation.commitPrepare"
  | "conversation.commitPersist"
  | "conversation.commitEvents"
  | "conversation.commitRecords"
  | "conversation.checkpoint"
  | "conversation.contextBuild";

export interface PerformanceMetricAggregate {
  readonly count: number;
  readonly totalDurationMs?: number;
  readonly maxDurationMs?: number;
}

export interface PerformanceMetricsSnapshot {
  readonly metrics: Readonly<Record<string, PerformanceMetricAggregate>>;
  readonly operations: Readonly<Record<string, PerformanceMetricAggregate>>;
  readonly gauges: Readonly<Record<string, number>>;
}

/** Content-free, non-throwing diagnostics used only by opt-in performance runs. */
export interface PerformanceDiagnosticsPort {
  readonly enabled: boolean;
  count(
    metric: PerformanceMetricName,
    amount?: number,
    operation?: string,
  ): void;
  duration(
    metric: PerformanceMetricName,
    durationMs: number,
    operation?: string,
  ): void;
  gauge(name: "websocket.sessions", value: number): void;
  snapshotAndReset(): PerformanceMetricsSnapshot;
}
