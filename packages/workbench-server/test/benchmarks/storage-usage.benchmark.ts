// From packages/workbench-server:
// NERVE_STORAGE_BENCHMARK=1 pnpm exec tsx test/benchmarks/storage-usage.benchmark.ts
// Synthetic temporary trees only. No Nerve home, database, or file contents are read.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import {
  dirSize,
  scanDirectoryUsage,
} from "../../src/domains/storage/storage-files.js";

if (process.env.NERVE_STORAGE_BENCHMARK !== "1") {
  console.log("Set NERVE_STORAGE_BENCHMARK=1 to run this isolated benchmark.");
  process.exit(0);
}

const trials = Number(process.env.NERVE_STORAGE_BENCHMARK_TRIALS ?? 9);
assert.ok(Number.isInteger(trials) && trials >= 3 && trials <= 100);
const root = await mkdtemp(join(tmpdir(), "nerve-storage-benchmark-"));
const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
};

async function redundant(path: string) {
  const start = performance.now();
  const cleanup = await dirSize(path);
  const cleanupMs = performance.now() - start;
  const categoryStart = performance.now();
  const category = await dirSize(path);
  const categoryMs = performance.now() - categoryStart;
  const ownerStart = performance.now();
  const owners = new Map<string, number>();
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      owners.set(entry.name, (await dirSize(join(path, entry.name))).bytes);
    }
  }
  assert.deepEqual(cleanup, category);
  return {
    bytes: category.bytes,
    files: category.files,
    owners,
    stages: { cleanupMs, categoryMs, ownerMs: performance.now() - ownerStart },
  };
}

async function singlePass(path: string) {
  const start = performance.now();
  const usage = await scanDirectoryUsage(path);
  return {
    bytes: usage.bytes,
    files: usage.files,
    owners: new Map(
      [...usage.directories].map(([name, tally]) => [name, tally.bytes]),
    ),
    stages: { scanMs: performance.now() - start },
  };
}

type Sample = {
  wallMs: number;
  cpuMs: number;
  rssBytes: number;
  eventLoopP95Ms: number;
  stages: Record<string, number>;
};
async function measure(
  run: () => ReturnType<typeof redundant> | ReturnType<typeof singlePass>,
): Promise<Sample> {
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  await sleep(5);
  let rssBytes = process.memoryUsage().rss;
  const sampleRss = setInterval(() => {
    rssBytes = Math.max(rssBytes, process.memoryUsage().rss);
  }, 5);
  const cpu = process.cpuUsage();
  const start = performance.now();
  try {
    const result = await run();
    const wallMs = performance.now() - start;
    const used = process.cpuUsage(cpu);
    rssBytes = Math.max(rssBytes, process.memoryUsage().rss);
    await sleep(5);
    return {
      wallMs,
      cpuMs: (used.user + used.system) / 1000,
      rssBytes,
      eventLoopP95Ms: delay.percentile(95) / 1e6,
      stages: result.stages,
    };
  } finally {
    clearInterval(sampleRss);
    delay.disable();
  }
}

try {
  console.log(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      trials,
      cache:
        "warm/OS-managed; creation and parity warm-up excluded; no privileged cache eviction",
      metrics:
        "wall/CPU per call; sampled process RSS (not incremental); event-loop p95 at 1ms resolution; no transfer boundary",
    }),
  );
  for (const workload of [
    { name: "tiny-files", owners: 40, filesPerOwner: 50, bytesPerFile: 64 },
    {
      name: "large-files",
      owners: 4,
      filesPerOwner: 4,
      bytesPerFile: 8 * 1024 * 1024,
    },
  ]) {
    const path = join(root, workload.name);
    const content = Buffer.alloc(workload.bytesPerFile, 120);
    for (let owner = 0; owner < workload.owners; owner += 1) {
      const directory = join(path, `owner_${owner}`);
      await mkdir(directory, { recursive: true });
      for (let file = 0; file < workload.filesPerOwner; file += 1) {
        await writeFile(join(directory, `file_${file}`), content);
      }
    }
    const old = await redundant(path);
    const optimized = await singlePass(path);
    assert.deepEqual(
      { ...old, stages: undefined },
      { ...optimized, stages: undefined },
    );
    const samples: Record<string, Sample[]> = { redundant: [], singlePass: [] };
    for (let trial = 0; trial < trials; trial += 1) {
      // Alternate ordering to reduce systematic cache/order bias.
      for (const mode of trial % 2
        ? ["singlePass", "redundant"]
        : ["redundant", "singlePass"]) {
        samples[mode].push(
          await measure(() =>
            mode === "redundant" ? redundant(path) : singlePass(path),
          ),
        );
      }
    }
    const summary = Object.fromEntries(
      Object.entries(samples).map(([mode, values]) => [
        mode,
        {
          wallP50Ms: percentile(
            values.map((v) => v.wallMs),
            0.5,
          ),
          wallP95Ms: percentile(
            values.map((v) => v.wallMs),
            0.95,
          ),
          cpuP50Ms: percentile(
            values.map((v) => v.cpuMs),
            0.5,
          ),
          peakSampledRssBytes: Math.max(...values.map((v) => v.rssBytes)),
          eventLoopP95Ms: percentile(
            values.map((v) => v.eventLoopP95Ms),
            0.95,
          ),
          stageP50Ms: Object.fromEntries(
            Object.keys(values[0].stages).map((stage) => [
              stage,
              percentile(
                values.map((v) => v.stages[stage]),
                0.5,
              ),
            ]),
          ),
        },
      ]),
    );
    console.log(
      JSON.stringify({
        workload: workload.name,
        owners: workload.owners,
        files: old.files,
        logicalBytes: old.bytes,
        summary,
      }),
    );
    await rm(path, { recursive: true, force: true });
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
