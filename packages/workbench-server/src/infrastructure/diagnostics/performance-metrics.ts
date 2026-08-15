import type {
  PerformanceDiagnosticsPort,
  PerformanceMetricAggregate,
  PerformanceMetricName,
  PerformanceMetricsSnapshot,
} from "../../core/ports.js";

type MutableAggregate = {
  count: number;
  totalDurationMs?: number;
  maxDurationMs?: number;
};

const emptySnapshot = (): PerformanceMetricsSnapshot => ({
  metrics: {},
  operations: {},
  gauges: {},
});

export const noopPerformanceDiagnostics: PerformanceDiagnosticsPort = {
  enabled: false,
  count: () => undefined,
  duration: () => undefined,
  gauge: () => undefined,
  snapshotAndReset: emptySnapshot,
};

export class PerformanceMetricsCollector implements PerformanceDiagnosticsPort {
  readonly enabled = true;
  readonly #allowedOperations: ReadonlySet<string>;
  #metrics = new Map<PerformanceMetricName, MutableAggregate>();
  #operations = new Map<string, MutableAggregate>();
  #gauges = new Map<string, number>();

  constructor(allowedOperations: Iterable<string> = []) {
    this.#allowedOperations = new Set(allowedOperations);
  }

  count(metric: PerformanceMetricName, amount = 1, operation?: string): void {
    if (!Number.isFinite(amount) || amount < 0) return;
    const aggregate = this.#aggregate(this.#metrics, metric);
    aggregate.count += amount;
    const operationAggregate = this.#operationAggregate(metric, operation);
    if (operationAggregate) operationAggregate.count += amount;
  }

  duration(
    metric: PerformanceMetricName,
    durationMs: number,
    operation?: string,
  ): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.#observe(this.#aggregate(this.#metrics, metric), durationMs);
    const operationAggregate = this.#operationAggregate(metric, operation);
    if (operationAggregate) this.#observe(operationAggregate, durationMs);
  }

  gauge(name: "websocket.sessions", value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.#gauges.set(name, value);
  }

  snapshotAndReset(): PerformanceMetricsSnapshot {
    const snapshot = {
      metrics: entries(this.#metrics),
      operations: entries(this.#operations),
      gauges: Object.fromEntries(this.#gauges),
    };
    this.#metrics = new Map();
    this.#operations = new Map();
    return snapshot;
  }

  #aggregate<K>(map: Map<K, MutableAggregate>, key: K): MutableAggregate {
    const existing = map.get(key);
    if (existing) return existing;
    const aggregate = { count: 0 };
    map.set(key, aggregate);
    return aggregate;
  }

  #operationAggregate(
    metric: PerformanceMetricName,
    operation: string | undefined,
  ): MutableAggregate | undefined {
    if (!operation || !this.#allowedOperations.has(operation)) return undefined;
    return this.#aggregate(this.#operations, `${metric}:${operation}`);
  }

  #observe(aggregate: MutableAggregate, durationMs: number): void {
    aggregate.count += 1;
    aggregate.totalDurationMs = (aggregate.totalDurationMs ?? 0) + durationMs;
    aggregate.maxDurationMs = Math.max(
      aggregate.maxDurationMs ?? 0,
      durationMs,
    );
  }
}

function entries<K extends string>(
  values: ReadonlyMap<K, MutableAggregate>,
): Record<string, PerformanceMetricAggregate> {
  return Object.fromEntries(
    [...values].map(([key, value]) => [
      key,
      value.totalDurationMs === undefined
        ? { count: value.count }
        : {
            count: value.count,
            totalDurationMs: value.totalDurationMs,
            maxDurationMs: value.maxDurationMs,
          },
    ]),
  );
}
