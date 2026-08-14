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

export async function summarizeStartup(path) {
  const bySource = new Map();
  await readJsonLines(path, (record) => {
    if (record?.type !== "nerve.startup") return;
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

export async function summarizePerformance(path) {
  const groups = new Map();
  await readJsonLines(path, (record) => {
    if (record?.type !== "nerve.performance") return;
    if (record.source === "daemon") {
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

  return Object.fromEntries(
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
  );
}

export async function buildPerformanceSummary({ startup, performance }) {
  return {
    startup: startup ? await summarizeStartup(startup) : {},
    performance: performance ? await summarizePerformance(performance) : {},
  };
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function formatMarkdown(summary) {
  const lines = ["# Nerve performance summary", "", "## Startup", ""];
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
  return `${lines.join("\n")}\n`;
}

function parseArguments(argv) {
  const options = { format: "markdown" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--startup") options.startup = argv[++index];
    else if (argument === "--performance") options.performance = argv[++index];
    else if (argument === "--format") options.format = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.startup && !options.performance) {
    throw new Error("Provide --startup and/or --performance JSONL path.");
  }
  if (options.format !== "json" && options.format !== "markdown") {
    throw new Error("--format must be json or markdown.");
  }
  return options;
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
