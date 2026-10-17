// Synthetic only: no project discovery, filesystem walks, Git or user data.
// Run: pnpm exec tsx test/benchmarks/file-completion.benchmark.ts
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { candidateFromPath } from "../../src/domains/completions/file-completion-candidates.js";
import { completeFileCandidates } from "./file-completion-optimized.js";
import { completeFileCandidates as baseline } from "./file-completion-baseline.js";

export function syntheticCompletionCandidates(size: number) {
  return Array.from({ length: size }, (_, index) => {
    const area = ["server", "app", "contracts", "工具", "İstanbul", "😀ui"][
      index % 6
    ];
    const name = [
      "CompletionService",
      "ComposerEditor",
      "package",
      "Readme",
      "résumé",
      "İndex",
    ][index % 6];
    return candidateFromPath(
      `packages/${area}/src/feature-${index % 97}/${name}${index}.ts`,
      index % 31 === 0 ? "directory" : "file",
    );
  });
}

const queries = [
  "packages",
  "CompletionService",
  "CED",
  "server Completion",
  "app/Composer",
  "résumé",
  "no-such-match",
];
const percentile = (samples: number[], fraction: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return Number(
    sorted[
      Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
    ]?.toFixed(3),
  );
};

async function main() {
  const rounds = Number(process.env.COMPLETION_BENCH_ROUNDS ?? 9);
  console.log(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      rounds,
      queries,
      resultLimit: 8,
    }),
  );
  for (const size of [1_000, 20_000, 100_000]) {
    const rssBefore = process.memoryUsage().rss;
    const buildStart = performance.now();
    const candidates = syntheticCompletionCandidates(size);
    const buildMs = performance.now() - buildStart;
    const rssAfterBuild = process.memoryUsage().rss;
    for (const query of queries) {
      assert.deepEqual(
        completeFileCandidates(candidates, query),
        baseline(candidates, query),
      );
    }
    const samples = {
      baseline: queries.map(() => [] as number[]),
      optimized: queries.map(() => [] as number[]),
    };
    const cpuStart = process.cpuUsage();
    for (let round = 0; round < rounds; round += 1) {
      const engines =
        round % 2
          ? (["optimized", "baseline"] as const)
          : (["baseline", "optimized"] as const);
      for (const engine of engines) {
        const complete =
          engine === "baseline" ? baseline : completeFileCandidates;
        for (const [index, query] of queries.entries()) {
          const start = performance.now();
          complete(candidates, query);
          samples[engine][index]!.push(performance.now() - start);
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const cpu = process.cpuUsage(cpuStart);
    const bursts: Record<string, { wallMs: number; timerDelayMs: number }> = {};
    for (const [name, complete] of [
      ["baseline", baseline],
      ["optimized", completeFileCandidates],
    ] as const) {
      const start = performance.now();
      const timer = new Promise<number>((resolve) =>
        setTimeout(() => resolve(performance.now() - start), 0),
      );
      for (const query of queries) complete(candidates, query);
      const wallMs = performance.now() - start;
      bursts[name] = {
        wallMs: Number(wallMs.toFixed(3)),
        timerDelayMs: Number((await timer).toFixed(3)),
      };
    }
    console.log(
      JSON.stringify({
        size,
        buildMs: Number(buildMs.toFixed(3)),
        rssBefore,
        rssAfterBuild,
        rssAfterQueries: process.memoryUsage().rss,
        cpuMs: (cpu.user + cpu.system) / 1000,
        queries: queries.map((query, index) => ({
          query,
          baseline: {
            p50: percentile(samples.baseline[index]!, 0.5),
            p95: percentile(samples.baseline[index]!, 0.95),
          },
          optimized: {
            p50: percentile(samples.optimized[index]!, 0.5),
            p95: percentile(samples.optimized[index]!, 0.95),
          },
        })),
        bursts,
      }),
    );
  }
}

// Importing the generator in a unit test must not execute the benchmark.
if (process.argv[1]?.endsWith("file-completion.benchmark.ts")) await main();
