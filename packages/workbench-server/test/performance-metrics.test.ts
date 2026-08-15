import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  noopPerformanceDiagnostics,
  PerformanceMetricsCollector,
} from "../src/infrastructure/diagnostics/performance-metrics.js";

describe("performance metrics collector", () => {
  it("aggregates bounded metrics and resets window activity", () => {
    const metrics = new PerformanceMetricsCollector(["project.list"]);
    metrics.count("task.outputBytes", 12);
    metrics.duration("rpc.handler", 4, "project.list");
    metrics.duration("rpc.handler", 9, "project.list");
    metrics.count("rpc.error", 1, "unknown.user.value");
    metrics.gauge("websocket.sessions", 2);

    assert.deepEqual(metrics.snapshotAndReset(), {
      metrics: {
        "task.outputBytes": { count: 12 },
        "rpc.handler": { count: 2, totalDurationMs: 13, maxDurationMs: 9 },
        "rpc.error": { count: 1 },
      },
      operations: {
        "rpc.handler:project.list": {
          count: 2,
          totalDurationMs: 13,
          maxDurationMs: 9,
        },
      },
      gauges: { "websocket.sessions": 2 },
    });
    assert.deepEqual(metrics.snapshotAndReset(), {
      metrics: {},
      operations: {},
      gauges: { "websocket.sessions": 2 },
    });
  });

  it("ignores invalid measurements and the no-op collector stays empty", () => {
    const metrics = new PerformanceMetricsCollector();
    metrics.count("event.durable", -1);
    metrics.duration("event.streamFlush", Number.NaN);
    assert.deepEqual(metrics.snapshotAndReset().metrics, {});
    noopPerformanceDiagnostics.count("task.outputBytes", 100);
    assert.deepEqual(noopPerformanceDiagnostics.snapshotAndReset(), {
      metrics: {},
      operations: {},
      gauges: {},
    });
  });
});
