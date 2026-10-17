// Synthetic workload and benchmark-only queue policies; no project/user data.
// Run: pnpm exec tsx test/benchmarks/file-completion-workload.benchmark.ts
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { CompletionItem } from "@nervekit/contracts/completions";
import {
  candidateFromPath,
  type FileCompletionCandidate,
} from "../../src/domains/completions/file-completion-candidates.js";
import { completeFileCandidates as baseline } from "./file-completion-baseline.js";
import { completeFileCandidates as optimized } from "./file-completion-optimized.js";

export function variedCompletionCandidates(
  size: number,
): FileCompletionCandidate[] {
  let seed = 0x5eed;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  return Array.from({ length: size }, (_, index) => {
    const bucket = random();
    // Explicit model, not observed traffic: 70% shallow, 25% medium, 5% deep.
    const depth =
      bucket < 0.7
        ? 2 + Math.floor(random() * 4)
        : bucket < 0.95
          ? 6 + Math.floor(random() * 5)
          : 11 + Math.floor(random() * 6);
    const segments = ["src", "test", "docs", "packages"];
    const path = Array.from({ length: depth - 1 }, (_, segment) =>
      segment === 0
        ? segments[Math.floor(random() * segments.length)]!
        : `feature-${Math.floor(random() * 40)}`,
    );
    const names = [
      "CompletionService",
      "ComposerEditor",
      "SessionController",
      "Readme",
      "package",
    ];
    const name =
      random() < 0.05
        ? ["résumé", "İndex", "😀View"][index % 3]!
        : names[Math.floor(random() * names.length)]!;
    const directory = random() < 0.1;
    path.push(
      `${name}${String(index).padStart(6, "0")}${directory ? "" : ".ts"}`,
    );
    return candidateFromPath(path.join("/"), directory ? "directory" : "file");
  });
}

export function completionWorkload(candidates: FileCompletionCandidate[]) {
  const deep = candidates.reduce((a, b) => (a.depth > b.depth ? a : b));
  const target = candidates.find((candidate) => candidate.kind === "file")!;
  const probes = [
    { category: "broad-prefix", query: "src" },
    ...["Co", "Comp", "Compo", "Composer", "ComposerEditor"].map((query) => ({
      category: "typing-prefix",
      query,
    })),
    { category: "selective-leaf", query: target.name },
    { category: "selective-full-path", query: target.relativePath },
    { category: "deep-ordered", query: `${deep.segments[0]}/${deep.name}` },
    { category: "deep-unordered", query: `${deep.name} ${deep.segments[0]}` },
    { category: "unicode", query: "résumé" },
    { category: "miss", query: "xyz-no-such-symbol" },
  ];
  // Includes a backspace and an unrelated search after a pause. Single-char and
  // trailing-slash service queries are deliberately absent: they list directories.
  const typed = [
    "Co",
    "Com",
    "Comp",
    "Compo",
    "Compos",
    "Composer",
    "Compose",
    "ComposerE",
  ];
  const stream = (intervalMs: number): ScheduledQuery[] => [
    ...typed.map((query, index) => ({ atMs: index * intervalMs, query })),
    { atMs: typed.length * intervalMs + 100, query: target.name },
    { atMs: typed.length * intervalMs + 140, query: "xyz-no-such-symbol" },
  ];
  return { probes, paced: stream(60), burst: stream(8) };
}

export type ScheduledQuery = { atMs: number; query: string };
export type QueuePolicy = "fifo" | "latest-pending";
type ScheduledEntry = ScheduledQuery & { sequence: number };

const roundMs = (value: number) => Number(value.toFixed(3));
function quantiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) =>
    roundMs(
      sorted[
        Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
      ] ?? 0,
    );
  return { p50: at(0.5), p95: at(0.95) };
}

// The callback may be synchronous TS today or an asynchronous native facade
// later. Only one call is active. latest-pending retains at most one queued call;
// it does NOT cancel a running call. Intake/drain yield to timer callbacks.
export async function scheduleCompletionWorkload(
  events: ScheduledQuery[],
  complete: (query: string) => CompletionItem[] | Promise<CompletionItem[]>,
  policy: QueuePolicy,
) {
  assert.ok(
    events.every(
      (event, index) =>
        event.atMs >= 0 &&
        (index === 0 || event.atMs >= events[index - 1]!.atMs),
    ),
  );
  const entries = events.map((event, sequence) => ({ ...event, sequence }));
  const groups = new Map<number, ScheduledEntry[]>();
  for (const entry of entries)
    groups.set(entry.atMs, [...(groups.get(entry.atMs) ?? []), entry]);
  const start = performance.now();
  const queue: ScheduledEntry[] = [];
  const samples: Array<{
    sequence: number;
    serviceMs: number;
    responseAgeMs: number;
    arrivalLagMs: number;
    obsolete: boolean;
  }> = [];
  const arrived = new Map<number, number>();
  const timerLag: number[] = [];
  let received = 0;
  let dropped = 0;
  let maxPending = 0;
  let active = false;
  let drainScheduled = false;
  let failed = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let heartbeatTarget = performance.now() + 5;
  let heartbeat: ReturnType<typeof setTimeout>;
  const beat = () => {
    timerLag.push(Math.max(0, performance.now() - heartbeatTarget));
    heartbeatTarget = performance.now() + 5;
    heartbeat = setTimeout(beat, 5);
  };
  heartbeat = setTimeout(beat, 5);
  try {
    await new Promise<void>((resolve, reject) => {
      const done = () =>
        received === entries.length && !active && queue.length === 0;
      const requestDrain = () => {
        if (drainScheduled || active || failed) return;
        drainScheduled = true;
        setImmediate(() => {
          drainScheduled = false;
          void drain();
        });
      };
      const drain = async () => {
        if (failed) return;
        const event = queue.shift();
        if (!event) {
          if (done()) resolve();
          return;
        }
        active = true;
        const callStart = performance.now();
        try {
          await complete(event.query);
          const finish = performance.now();
          const elapsed = finish - start;
          // A request may already be logically superseded even while its later
          // arrival timer cannot run because synchronous ranking blocks Node.
          const obsolete = entries.some(
            (entry) => entry.sequence > event.sequence && entry.atMs <= elapsed,
          );
          samples.push({
            sequence: event.sequence,
            serviceMs: finish - callStart,
            responseAgeMs: elapsed - event.atMs,
            arrivalLagMs:
              (arrived.get(event.sequence) ?? callStart) - start - event.atMs,
            obsolete,
          });
        } catch (error) {
          failed = true;
          reject(error);
        } finally {
          active = false;
        }
        if (done()) resolve();
        else requestDrain();
      };
      for (const [atMs, group] of groups) {
        timers.push(
          setTimeout(() => {
            if (failed) return;
            received += group.length;
            for (const entry of group) {
              arrived.set(entry.sequence, performance.now());
              if (policy === "latest-pending" && queue.length) {
                queue.pop();
                dropped += 1;
              }
              queue.push(entry);
              maxPending = Math.max(maxPending, queue.length);
            }
            requestDrain();
          }, atMs),
        );
      }
      if (events.length === 0) resolve();
    });
    // Let an overdue heartbeat observe the final synchronous call as well.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  } finally {
    clearTimeout(heartbeat);
    for (const timer of timers) clearTimeout(timer);
  }
  return {
    requested: events.length,
    completed: samples.length,
    dropped,
    maxPending,
    obsoleteCompleted: samples.filter((sample) => sample.obsolete).length,
    completedSequences: samples.map((sample) => sample.sequence),
    wallMs: roundMs(performance.now() - start),
    serviceMs: quantiles(samples.map((sample) => sample.serviceMs)),
    responseAgeMs: quantiles(samples.map((sample) => sample.responseAgeMs)),
    arrivalLagMs: quantiles(samples.map((sample) => sample.arrivalLagMs)),
    heartbeatLagMs: {
      ...quantiles(timerLag),
      max: roundMs(Math.max(0, ...timerLag)),
    },
  };
}

async function main() {
  const rounds = Number(process.env.COMPLETION_BENCH_ROUNDS ?? 3);
  const sizes = (process.env.COMPLETION_BENCH_SIZES ?? "1000,20000,100000")
    .split(",")
    .map(Number);
  assert.ok(Number.isInteger(rounds) && rounds > 0);
  assert.ok(sizes.every((size) => Number.isInteger(size) && size > 0));
  console.log(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      rounds,
      sizes,
      seed: "0x5eed",
      schedule: { pacedIntervalMs: 60, burstIntervalMs: 8, heartbeatMs: 5 },
      engines: ["frozen-baseline", "frozen-optimized"],
    }),
  );
  for (const size of sizes) {
    const buildStart = performance.now();
    const candidates = variedCompletionCandidates(size);
    const buildMs = performance.now() - buildStart;
    const workload = completionWorkload(candidates);
    for (const query of new Set(
      [...workload.probes, ...workload.paced, ...workload.burst].map(
        (entry) => entry.query,
      ),
    )) {
      assert.deepEqual(
        optimized(candidates, query),
        baseline(candidates, query),
      );
    }
    const results = workload.probes.map((probe) => ({
      ...probe,
      baseline: [] as number[],
      optimized: [] as number[],
    }));
    for (let round = 0; round < rounds; round += 1) {
      const engines =
        round % 2
          ? ([
              ["optimized", optimized],
              ["baseline", baseline],
            ] as const)
          : ([
              ["baseline", baseline],
              ["optimized", optimized],
            ] as const);
      for (const [name, complete] of engines)
        for (const probe of results) {
          const start = performance.now();
          complete(candidates, probe.query);
          probe[name].push(performance.now() - start);
        }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    console.log(
      JSON.stringify({
        size,
        buildMs: roundMs(buildMs),
        depths: {
          min: candidates.reduce(
            (min, candidate) => Math.min(min, candidate.depth),
            Infinity,
          ),
          max: candidates.reduce(
            (max, candidate) => Math.max(max, candidate.depth),
            0,
          ),
          mean: roundMs(
            candidates.reduce((sum, candidate) => sum + candidate.depth, 0) /
              size,
          ),
        },
        probes: results.map(
          ({ baseline: before, optimized: after, ...probe }) => ({
            ...probe,
            baseline: quantiles(before),
            optimized: quantiles(after),
          }),
        ),
        rss: process.memoryUsage().rss,
      }),
    );
    for (const scenario of ["paced", "burst"] as const)
      for (const policy of ["fifo", "latest-pending"] as const) {
        for (const [engine, complete] of [
          ["baseline", baseline],
          ["optimized", optimized],
        ] as const) {
          console.log(
            JSON.stringify({
              size,
              scenario,
              policy,
              engine,
              ...(await scheduleCompletionWorkload(
                workload[scenario],
                (query) => complete(candidates, query),
                policy,
              )),
            }),
          );
        }
      }
  }
}

if (process.argv[1]?.endsWith("file-completion-workload.benchmark.ts"))
  await main();
