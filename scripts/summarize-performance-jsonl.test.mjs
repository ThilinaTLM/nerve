import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  buildPerformanceSummary,
  formatMarkdown,
  normalizeTimeWindow,
  parseArguments,
  readJsonLines,
} from "./summarize-performance-jsonl.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture(name, content) {
  const root = await mkdtemp(join(tmpdir(), "nerve-performance-summary-"));
  roots.push(root);
  const path = join(root, name);
  await writeFile(path, content, "utf8");
  return path;
}

describe("performance JSONL summary", () => {
  it("summarizes startup phases, store timings, and process metrics", async () => {
    const startup = await fixture(
      "startup.jsonl",
      [
        {
          type: "nerve.startup",
          source: "daemon",
          ts: "2026-08-15T10:00:00.000Z",
          listeningDurationMs: 300,
          storeDurationsMs: { tasks: 100 },
        },
        {
          type: "nerve.startup",
          source: "daemon",
          ts: "2026-08-15T10:01:00.000Z",
          listeningDurationMs: 100,
          storeDurationsMs: { tasks: 50 },
        },
        {
          type: "nerve.startup",
          source: "daemon",
          ts: "2026-08-15T10:02:00.000Z",
          listeningDurationMs: 200,
          storeDurationsMs: { tasks: 75 },
          secret: "ignored",
        },
        {
          type: "nerve.startup",
          source: "desktop",
          ts: "2026-08-15T10:03:00.000Z",
          totalMs: 400,
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );
    const performance = await fixture(
      "performance.jsonl",
      [
        {
          type: "nerve.performance",
          source: "daemon",
          ts: "2026-08-15T10:04:00.000Z",
          cpuPercent: 1,
          rssBytes: 100,
          heapUsedBytes: 50,
          sampleWindowMs: 10000,
          eventLoopUtilization: 0.25,
          eventLoopDelayMs: { p95Ms: 4, maxMs: 8 },
          activity: {
            metrics: {
              "private.payload.key": { count: 99 },
              "rpc.handler": {
                count: 2,
                totalDurationMs: 10,
                maxDurationMs: 7,
              },
            },
            operations: {
              "private.operation:secret": { count: 99 },
              "rpc.handler:project.list": {
                count: 2,
                totalDurationMs: 10,
                maxDurationMs: 7,
              },
            },
          },
        },
        {
          type: "nerve.performance",
          source: "daemon",
          ts: "2026-08-15T10:05:00.000Z",
          cpuPercent: 3,
          rssBytes: 160,
          heapUsedBytes: 70,
          sampleWindowMs: 10000,
          eventLoopUtilization: 0.75,
          eventLoopDelayMs: { p95Ms: 6, maxMs: 12 },
          activity: {
            metrics: {
              "rpc.handler": {
                count: 3,
                totalDurationMs: 20,
                maxDurationMs: 9,
              },
            },
            operations: {
              "rpc.handler:project.list": {
                count: 3,
                totalDurationMs: 20,
                maxDurationMs: 9,
              },
            },
          },
        },
        {
          type: "nerve.performance",
          source: "desktop",
          ts: "2026-08-15T10:06:00.000Z",
          processes: [
            { role: "Tab", cpuPercent: 10, rssBytes: 200 },
            { role: "GPU", cpuPercent: 2, rssBytes: 80 },
          ],
        },
        {
          type: "nerve.performance",
          source: "desktop",
          ts: "2026-08-15T10:07:00.000Z",
          processes: [{ role: "Tab", cpuPercent: 20, rssBytes: 260 }],
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );

    const summary = await buildPerformanceSummary({ startup, performance });
    assert.deepEqual(summary.window, {
      requestedSince: null,
      requestedUntil: null,
      firstIncludedAt: "2026-08-15T10:00:00.000Z",
      lastIncludedAt: "2026-08-15T10:07:00.000Z",
    });
    assert.equal(summary.startup.daemon.listeningDurationMs.median, 200);
    assert.equal(summary.startup.daemon["store.tasks"].average, 75);
    assert.equal(summary.performance["daemon:daemon"].cpuPercent.average, 2);
    assert.equal(summary.performance["daemon:daemon"].rssBytes.growth, 60);
    assert.equal(summary.performance["desktop:Tab"].cpuPercent.p95, 20);
    assert.equal(summary.performance["desktop:Tab"].rssBytes.growth, 60);
    assert.equal(summary.eventLoop.utilization.average, 0.5);
    assert.equal(summary.activity["rpc.handler"].count, 5);
    assert.equal(summary.activity["rpc.handler"].averageRatePerSecond, 0.25);
    assert.equal(
      summary.operations["rpc.handler:project.list"].totalDurationMs,
      30,
    );
    assert.deepEqual(
      summary.hottestDaemonSamples.map((sample) => sample.cpuPercent),
      [3, 1],
    );
    assert.equal(JSON.stringify(summary).includes("secret"), false);
    assert.equal(JSON.stringify(summary).includes("private"), false);

    const markdown = formatMarkdown(summary);
    assert.match(markdown, /store\.tasks/);
    assert.match(markdown, /desktop:Tab/);
    assert.match(markdown, /rpc\.handler:project\.list/);
    assert.match(markdown, /Hottest daemon samples/);
  });

  it("filters incident windows and bounds hottest daemon samples", async () => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      type: "nerve.performance",
      source: "daemon",
      ts: `2026-08-15T10:${String(index).padStart(2, "0")}:00.000Z`,
      cpuPercent: index,
      sampleWindowMs: 10_000,
      activity: {
        metrics: { "task.outputLine": { count: index } },
        operations: {},
      },
    }));
    const performance = await fixture(
      "performance-window.jsonl",
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );

    const complete = await buildPerformanceSummary({ performance });
    assert.equal(complete.hottestDaemonSamples.length, 10);
    assert.deepEqual(
      complete.hottestDaemonSamples.map((sample) => sample.cpuPercent),
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
    );

    const incident = await buildPerformanceSummary({
      performance,
      since: "2026-08-15T10:05:00Z",
      until: "2026-08-15T10:10:00Z",
    });
    assert.deepEqual(incident.window, {
      requestedSince: "2026-08-15T10:05:00.000Z",
      requestedUntil: "2026-08-15T10:10:00.000Z",
      firstIncludedAt: "2026-08-15T10:05:00.000Z",
      lastIncludedAt: "2026-08-15T10:10:00.000Z",
    });
    assert.equal(incident.performance["daemon:daemon"].samples, 6);
    assert.equal(incident.activity["task.outputLine"].count, 45);
  });

  it("defaults to JSON arguments and validates incident bounds", () => {
    assert.deepEqual(parseArguments(["--performance", "/tmp/perf.jsonl"]), {
      format: "json",
      performance: "/tmp/perf.jsonl",
    });
    assert.throws(
      () => normalizeTimeWindow({ since: "not-a-time" }),
      /--since must be an ISO timestamp/,
    );
    assert.throws(
      () =>
        normalizeTimeWindow({
          since: "2026-08-15T11:00:00Z",
          until: "2026-08-15T10:00:00Z",
        }),
      /--since must be earlier/,
    );
    assert.throws(
      () => parseArguments(["--performance"]),
      /--performance requires a value/,
    );
  });

  it("accepts a valid final line and ignores one torn final line", async () => {
    const valid = await fixture("valid.jsonl", '{"value":1}');
    const torn = await fixture("torn.jsonl", '{"value":1}\n{"value":');
    const values = [];
    await readJsonLines(valid, (record) => values.push(record.value));
    await readJsonLines(torn, (record) => values.push(record.value));
    assert.deepEqual(values, [1, 1]);
  });

  it("rejects malformed interior records", async () => {
    const path = await fixture(
      "malformed.jsonl",
      '{"value":1}\nnot-json\n{"value":2}\n',
    );
    await assert.rejects(
      readJsonLines(path, () => undefined),
      /:2/,
    );
  });

  it("returns empty sections for empty inputs", async () => {
    const startup = await fixture("startup.jsonl", "");
    const performance = await fixture("performance.jsonl", "");
    assert.deepEqual(await buildPerformanceSummary({ startup, performance }), {
      window: {
        requestedSince: null,
        requestedUntil: null,
        firstIncludedAt: null,
        lastIncludedAt: null,
      },
      startup: {},
      performance: {},
      eventLoop: {
        utilization: undefined,
        delayP95Ms: undefined,
        delayMaxMs: undefined,
      },
      activity: {},
      operations: {},
      hottestDaemonSamples: [],
    });
  });
});
