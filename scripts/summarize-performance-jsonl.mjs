#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { pathToFileURL } from "node:url";

const STARTUP_PHASES = [
  "totalMs",
  "daemonMs",
  "navigationMs",
  "listeningDurationMs",
  "storageDurationMs",
  "loggerHydrateDurationMs",
  "agentSkillsDurationMs",
  "eventsHydrateDurationMs",
  "registryStateDurationMs",
  "indexDurationMs",
  "storesHydrationDurationMs",
  "agentsHydrationDurationMs",
  "runRecoveryDurationMs",
  "humanInputRecoveryDurationMs",
  "projectorDurationMs",
  "taskNotificationsDurationMs",
];

export function normalizeTimeWindow({ since, until } = {}) {
  const sinceMs = parseTimestamp("--since", since);
  const untilMs = parseTimestamp("--until", until);
  if (sinceMs !== undefined && untilMs !== undefined && sinceMs > untilMs) {
    throw new Error("--since must be earlier than or equal to --until.");
  }
  return {
    sinceMs,
    untilMs,
    requestedSince:
      sinceMs === undefined ? null : new Date(sinceMs).toISOString(),
    requestedUntil:
      untilMs === undefined ? null : new Date(untilMs).toISOString(),
  };
}

function parseTimestamp(name, value) {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new Error(`${name} must be an ISO timestamp.`);
  return parsed;
}

function includedTimestamp(record, window) {
  const timestamp =
    typeof record?.ts === "string" ? Date.parse(record.ts) : NaN;
  if (window.sinceMs === undefined && window.untilMs === undefined) {
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (!Number.isFinite(timestamp)) return undefined;
  if (window.sinceMs !== undefined && timestamp < window.sinceMs)
    return undefined;
  if (window.untilMs !== undefined && timestamp > window.untilMs)
    return undefined;
  return timestamp;
}

function recordIncluded(record, window) {
  if (window.sinceMs === undefined && window.untilMs === undefined) return true;
  return includedTimestamp(record, window) !== undefined;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return undefined;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function numericSummary(values) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0],
    max: sorted.at(-1),
  };
}

export async function readJsonLines(path, onRecord) {
  let buffer = "";
  let lineNumber = 0;
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      lineNumber += 1;
      if (line) {
        try {
          onRecord(JSON.parse(line));
        } catch (error) {
          throw new Error(`Malformed JSONL at ${path}:${lineNumber}`, {
            cause: error,
          });
        }
      }
      newline = buffer.indexOf("\n");
    }
  }

  const finalLine = buffer.trim();
  if (!finalLine) return;
  try {
    onRecord(JSON.parse(finalLine));
  } catch {
    // Append-oriented logs may end with one torn record after a crash.
  }
}

export async function summarizeStartup(path, options = {}) {
  const window = options.window ?? normalizeTimeWindow();
  const bySource = new Map();
  await readJsonLines(path, (record) => {
    if (record?.type !== "nerve.startup" || !recordIncluded(record, window))
      return;
    options.observeTimestamp?.(includedTimestamp(record, window));
    const source = record.source === "desktop" ? "desktop" : "daemon";
    const sourcePhases = bySource.get(source) ?? new Map();
    bySource.set(source, sourcePhases);
    for (const phase of STARTUP_PHASES) {
      const value = record[phase];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const values = sourcePhases.get(phase) ?? [];
      values.push(value);
      sourcePhases.set(phase, values);
    }
    if (source === "daemon" && record.storeDurationsMs) {
      for (const [name, value] of Object.entries(record.storeDurationsMs)) {
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        const phase = `store.${name}`;
        const values = sourcePhases.get(phase) ?? [];
        values.push(value);
        sourcePhases.set(phase, values);
      }
    }
  });

  return Object.fromEntries(
    [...bySource].map(([source, phases]) => [
      source,
      Object.fromEntries(
        [...phases].map(([phase, values]) => [phase, numericSummary(values)]),
      ),
    ]),
  );
}

function addPerformanceSample(groups, key, sample) {
  const group = groups.get(key) ?? {
    source: sample.source,
    role: sample.role,
    samples: 0,
    cpu: [],
    rss: [],
    heap: [],
  };
  group.samples += 1;
  if (typeof sample.cpuPercent === "number") group.cpu.push(sample.cpuPercent);
  if (typeof sample.rssBytes === "number") group.rss.push(sample.rssBytes);
  if (typeof sample.heapUsedBytes === "number")
    group.heap.push(sample.heapUsedBytes);
  groups.set(key, group);
}

function metricSummary(values, includeGrowth = false) {
  const summary = numericSummary(values);
  if (!summary) return undefined;
  return includeGrowth
    ? { ...summary, growth: values.at(-1) - values[0] }
    : summary;
}

function addActivityAggregate(groups, key, value, includeInRate) {
  if (!value || typeof value !== "object") return;
  const count = typeof value.count === "number" ? value.count : 0;
  const group = groups.get(key) ?? {
    count: 0,
    totalDurationMs: 0,
    durationSamples: 0,
    maxDurationMs: 0,
    rateCount: 0,
  };
  group.count += count;
  if (includeInRate) group.rateCount += count;
  if (typeof value.totalDurationMs === "number") {
    group.totalDurationMs += value.totalDurationMs;
    group.durationSamples += count;
  }
  if (typeof value.maxDurationMs === "number") {
    group.maxDurationMs = Math.max(group.maxDurationMs, value.maxDurationMs);
  }
  groups.set(key, group);
}

function activitySummary(groups, sampledMs) {
  return Object.fromEntries(
    [...groups].map(([key, group]) => [
      key,
      {
        count: group.count,
        averageRatePerSecond:
          sampledMs > 0 ? group.rateCount / (sampledMs / 1000) : undefined,
        totalDurationMs:
          group.durationSamples > 0 ? group.totalDurationMs : undefined,
        averageDurationMs:
          group.durationSamples > 0
            ? group.totalDurationMs / group.durationSamples
            : undefined,
        maxDurationMs:
          group.durationSamples > 0 ? group.maxDurationMs : undefined,
      },
    ]),
  );
}

const KNOWN_ACTIVITY_METRICS = new Set([
  "rpc.handler",
  "rpc.error",
  "event.durable",
  "event.ephemeral",
  "event.listenerDelivery",
  "event.publishFailure",
  "event.streamFlush",
  "event.streamFlushEvents",
  "event.fsync",
  "websocket.sessionOpened",
  "websocket.sessionClosed",
  "websocket.sequencedDelivery",
  "websocket.notifyDelivery",
  "task.outputChunk",
  "task.outputBytes",
  "task.outputLine",
  "task.outputCapture",
  "task.outputPublication",
  "git.watcherCreated",
  "git.watcherEvicted",
  "git.filesystemEvent",
  "git.invalidation",
  "git.metadataInvalidation",
]);

function knownOperationMetric(key) {
  return /^rpc\.(?:handler|error):[A-Za-z0-9_.-]{1,160}$/.test(key);
}

function sanitizedAggregates(
  values,
  allowKey,
  limit = Number.POSITIVE_INFINITY,
) {
  if (!values || typeof values !== "object") return {};
  const entries = [];
  for (const [key, value] of Object.entries(values)) {
    if (!allowKey(key) || !value || typeof value !== "object") continue;
    const aggregate = {};
    for (const field of ["count", "totalDurationMs", "maxDurationMs"]) {
      const number = value[field];
      if (typeof number === "number" && Number.isFinite(number) && number >= 0)
        aggregate[field] = number;
    }
    if (typeof aggregate.count === "number") entries.push([key, aggregate]);
  }
  return Object.fromEntries(
    entries
      .sort(
        ([, left], [, right]) =>
          (right.totalDurationMs ?? right.count) -
          (left.totalDurationMs ?? left.count),
      )
      .slice(0, limit),
  );
}

function hottestSample(record) {
  if (
    typeof record.cpuPercent !== "number" ||
    !Number.isFinite(record.cpuPercent)
  )
    return undefined;
  return {
    ts: typeof record.ts === "string" ? record.ts : null,
    cpuPercent: record.cpuPercent,
    sampleWindowMs:
      typeof record.sampleWindowMs === "number" ? record.sampleWindowMs : null,
    eventLoopUtilization:
      typeof record.eventLoopUtilization === "number"
        ? record.eventLoopUtilization
        : null,
    eventLoopDelayP95Ms:
      typeof record.eventLoopDelayMs?.p95Ms === "number"
        ? record.eventLoopDelayMs.p95Ms
        : null,
    rssBytes: typeof record.rssBytes === "number" ? record.rssBytes : null,
    heapUsedBytes:
      typeof record.heapUsedBytes === "number" ? record.heapUsedBytes : null,
    activity: sanitizedAggregates(
      record.activity?.metrics,
      (key) => KNOWN_ACTIVITY_METRICS.has(key),
      12,
    ),
    operations: sanitizedAggregates(
      record.activity?.operations,
      knownOperationMetric,
      12,
    ),
  };
}

function retainHottest(samples, sample) {
  if (!sample) return;
  samples.push(sample);
  samples.sort(
    (left, right) =>
      right.cpuPercent - left.cpuPercent ||
      String(left.ts).localeCompare(String(right.ts)),
  );
  if (samples.length > 10) samples.length = 10;
}

export async function summarizePerformance(path, options = {}) {
  const window = options.window ?? normalizeTimeWindow();
  const groups = new Map();
  const activity = new Map();
  const operations = new Map();
  const eventLoopUtilization = [];
  const eventLoopDelayP95 = [];
  const eventLoopDelayMax = [];
  const hottestDaemonSamples = [];
  let sampledMs = 0;
  await readJsonLines(path, (record) => {
    if (record?.type !== "nerve.performance" || !recordIncluded(record, window))
      return;
    options.observeTimestamp?.(includedTimestamp(record, window));
    if (record.source === "daemon") {
      retainHottest(hottestDaemonSamples, hottestSample(record));
      const sampleWindowMs =
        typeof record.sampleWindowMs === "number"
          ? Math.max(0, record.sampleWindowMs)
          : 0;
      sampledMs += sampleWindowMs;
      if (typeof record.eventLoopUtilization === "number")
        eventLoopUtilization.push(record.eventLoopUtilization);
      if (typeof record.eventLoopDelayMs?.p95Ms === "number")
        eventLoopDelayP95.push(record.eventLoopDelayMs.p95Ms);
      if (typeof record.eventLoopDelayMs?.maxMs === "number")
        eventLoopDelayMax.push(record.eventLoopDelayMs.maxMs);
      for (const [key, value] of Object.entries(
        sanitizedAggregates(record.activity?.metrics, (metric) =>
          KNOWN_ACTIVITY_METRICS.has(metric),
        ),
      ))
        addActivityAggregate(activity, key, value, sampleWindowMs > 0);
      for (const [key, value] of Object.entries(
        sanitizedAggregates(record.activity?.operations, knownOperationMetric),
      ))
        addActivityAggregate(operations, key, value, sampleWindowMs > 0);
      addPerformanceSample(groups, "daemon:daemon", {
        source: "daemon",
        role: "daemon",
        cpuPercent: record.cpuPercent,
        rssBytes: record.rssBytes,
        heapUsedBytes: record.heapUsedBytes,
      });
      return;
    }
    if (record.source !== "desktop" || !Array.isArray(record.processes)) return;
    for (const process of record.processes) {
      const role = typeof process?.role === "string" ? process.role : "unknown";
      addPerformanceSample(groups, `desktop:${role}`, {
        source: "desktop",
        role,
        cpuPercent: process?.cpuPercent,
        rssBytes: process?.rssBytes,
      });
    }
  });

  return {
    processes: Object.fromEntries(
      [...groups].map(([key, group]) => [
        key,
        {
          source: group.source,
          role: group.role,
          samples: group.samples,
          cpuPercent: metricSummary(group.cpu),
          rssBytes: metricSummary(group.rss, true),
          heapUsedBytes: metricSummary(group.heap, true),
        },
      ]),
    ),
    eventLoop: {
      utilization: numericSummary(eventLoopUtilization),
      delayP95Ms: numericSummary(eventLoopDelayP95),
      delayMaxMs: numericSummary(eventLoopDelayMax),
    },
    activity: activitySummary(activity, sampledMs),
    hottestDaemonSamples,
    operations: Object.fromEntries(
      Object.entries(activitySummary(operations, sampledMs)).sort(
        ([, left], [, right]) =>
          (right.totalDurationMs ?? 0) - (left.totalDurationMs ?? 0) ||
          right.count - left.count,
      ),
    ),
  };
}

export async function buildPerformanceSummary({
  startup,
  performance,
  since,
  until,
}) {
  const timeWindow = normalizeTimeWindow({ since, until });
  let firstIncludedMs;
  let lastIncludedMs;
  const observeTimestamp = (timestamp) => {
    if (timestamp === undefined) return;
    firstIncludedMs = Math.min(firstIncludedMs ?? timestamp, timestamp);
    lastIncludedMs = Math.max(lastIncludedMs ?? timestamp, timestamp);
  };
  const startupSummary = startup
    ? await summarizeStartup(startup, {
        window: timeWindow,
        observeTimestamp,
      })
    : {};
  const summarizedPerformance = performance
    ? await summarizePerformance(performance, {
        window: timeWindow,
        observeTimestamp,
      })
    : {
        processes: {},
        eventLoop: {},
        activity: {},
        hottestDaemonSamples: [],
        operations: {},
      };
  return {
    window: {
      requestedSince: timeWindow.requestedSince,
      requestedUntil: timeWindow.requestedUntil,
      firstIncludedAt:
        firstIncludedMs === undefined
          ? null
          : new Date(firstIncludedMs).toISOString(),
      lastIncludedAt:
        lastIncludedMs === undefined
          ? null
          : new Date(lastIncludedMs).toISOString(),
    },
    startup: startupSummary,
    performance: summarizedPerformance.processes,
    eventLoop: summarizedPerformance.eventLoop,
    activity: summarizedPerformance.activity,
    operations: summarizedPerformance.operations,
    hottestDaemonSamples: summarizedPerformance.hottestDaemonSamples,
  };
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function formatMarkdown(summary) {
  const lines = [
    "# Nerve performance summary",
    "",
    `Window: ${summary.window?.firstIncludedAt ?? "unknown"} to ${summary.window?.lastIncludedAt ?? "unknown"}`,
    "",
    "## Startup",
    "",
  ];
  for (const [source, phases] of Object.entries(summary.startup)) {
    lines.push(
      `### ${source}`,
      "",
      "| Phase | Runs | Median ms | Min–max ms |",
      "|---|---:|---:|---:|",
    );
    for (const [phase, stats] of Object.entries(phases)) {
      lines.push(
        `| ${phase} | ${stats.count} | ${formatNumber(stats.median)} | ${formatNumber(stats.min)}–${formatNumber(stats.max)} |`,
      );
    }
    lines.push("");
  }
  if (Object.keys(summary.startup).length === 0)
    lines.push("No startup records.", "");

  lines.push("## Process metrics", "");
  if (Object.keys(summary.performance).length === 0) {
    lines.push("No performance records.", "");
  } else {
    lines.push(
      "| Source / role | Samples | CPU avg/p95/max % | RSS avg/p95/max bytes | RSS growth bytes |",
      "|---|---:|---:|---:|---:|",
    );
    for (const [key, group] of Object.entries(summary.performance)) {
      const cpu = group.cpuPercent;
      const rss = group.rssBytes;
      lines.push(
        `| ${key} | ${group.samples} | ${cpu ? `${formatNumber(cpu.average)}/${formatNumber(cpu.p95)}/${formatNumber(cpu.max)}` : "—"} | ${rss ? `${formatNumber(rss.average)}/${formatNumber(rss.p95)}/${formatNumber(rss.max)}` : "—"} | ${rss ? formatNumber(rss.growth) : "—"} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Daemon event loop", "");
  const utilization = summary.eventLoop?.utilization;
  const delayP95 = summary.eventLoop?.delayP95Ms;
  lines.push(
    utilization
      ? `Utilization avg/p95/max: ${formatNumber(utilization.average)}/${formatNumber(utilization.p95)}/${formatNumber(utilization.max)}`
      : "No event-loop records.",
    delayP95
      ? `Delay p95 avg/p95/max ms: ${formatNumber(delayP95.average)}/${formatNumber(delayP95.p95)}/${formatNumber(delayP95.max)}`
      : "",
    "",
  );

  lines.push("## Daemon activity", "");
  if (Object.keys(summary.activity ?? {}).length === 0) {
    lines.push("No activity records.", "");
  } else {
    lines.push(
      "| Metric | Count | Avg rate/s | Total duration ms | Avg/max duration ms |",
      "|---|---:|---:|---:|---:|",
    );
    for (const [key, metric] of Object.entries(summary.activity)) {
      lines.push(
        `| ${key} | ${formatNumber(metric.count)} | ${metric.averageRatePerSecond === undefined ? "—" : formatNumber(metric.averageRatePerSecond)} | ${metric.totalDurationMs === undefined ? "—" : formatNumber(metric.totalDurationMs)} | ${metric.averageDurationMs === undefined ? "—" : `${formatNumber(metric.averageDurationMs)}/${formatNumber(metric.maxDurationMs)}`} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Hottest daemon samples", "");
  if ((summary.hottestDaemonSamples ?? []).length === 0) {
    lines.push("No daemon CPU samples.", "");
  } else {
    lines.push(
      "| Time | CPU % | Event-loop utilization | Event-loop p95 ms | RSS bytes |",
      "|---|---:|---:|---:|---:|",
    );
    for (const sample of summary.hottestDaemonSamples) {
      lines.push(
        `| ${sample.ts ?? "—"} | ${formatNumber(sample.cpuPercent)} | ${sample.eventLoopUtilization === null ? "—" : formatNumber(sample.eventLoopUtilization)} | ${sample.eventLoopDelayP95Ms === null ? "—" : formatNumber(sample.eventLoopDelayP95Ms)} | ${sample.rssBytes === null ? "—" : formatNumber(sample.rssBytes)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## RPC operations", "");
  if (Object.keys(summary.operations ?? {}).length === 0) {
    lines.push("No operation records.", "");
  } else {
    lines.push(
      "| Operation metric | Count | Total duration ms | Avg/max duration ms |",
      "|---|---:|---:|---:|",
    );
    for (const [key, metric] of Object.entries(summary.operations)) {
      lines.push(
        `| ${key} | ${formatNumber(metric.count)} | ${metric.totalDurationMs === undefined ? "—" : formatNumber(metric.totalDurationMs)} | ${metric.averageDurationMs === undefined ? "—" : `${formatNumber(metric.averageDurationMs)}/${formatNumber(metric.maxDurationMs)}`} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function parseArguments(argv) {
  const options = { format: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--startup")
      options.startup = argumentValue(argv, ++index, argument);
    else if (argument === "--performance")
      options.performance = argumentValue(argv, ++index, argument);
    else if (argument === "--format")
      options.format = argumentValue(argv, ++index, argument);
    else if (argument === "--since")
      options.since = argumentValue(argv, ++index, argument);
    else if (argument === "--until")
      options.until = argumentValue(argv, ++index, argument);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.startup && !options.performance) {
    throw new Error("Provide --startup and/or --performance JSONL path.");
  }
  if (options.format !== "json" && options.format !== "markdown") {
    throw new Error("--format must be json or markdown.");
  }
  normalizeTimeWindow(options);
  return options;
}

function argumentValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value.`);
  return value;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const summary = await buildPerformanceSummary(options);
  process.stdout.write(
    options.format === "json"
      ? `${JSON.stringify(summary, undefined, 2)}\n`
      : formatMarkdown(summary),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
