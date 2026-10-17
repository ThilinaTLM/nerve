// Isolated-process synthetic gate. No project discovery, Git, filesystem walks
// or user data. Run: pnpm exec tsx test/benchmarks/file-completion-native.benchmark.ts
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { CompletionItem } from "@nervekit/contracts/completions";
import type { FileCompletionIndex } from "@nervekit/native";
import {
  candidateFromPath,
  type FileCompletionCandidate,
} from "../../src/domains/completions/file-completion-candidates.js";
import { toCompletionItem } from "../../src/domains/completions/file-completion-items.js";
import { FileCompletionService } from "../../src/domains/completions/file-completion-service.js";
import { completeFileCandidates as optimized } from "./file-completion-optimized.js";
import {
  completionWorkload,
  scheduleCompletionWorkload,
  variedCompletionCandidates,
} from "./file-completion-workload.benchmark.js";

type Engine = "ts" | "native" | "service";
const round = (value: number) => Number(value.toFixed(3));
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const quantiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: round(sorted[Math.floor(sorted.length * 0.5)] ?? 0),
    p95: round(
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ??
        0,
    ),
  };
};
async function collect() {
  for (let index = 0; index < 3; index += 1) {
    global.gc?.();
    await flush();
  }
}
async function measure<T>(action: () => T | Promise<T>) {
  let last = performance.now();
  const lags: number[] = [];
  const heartbeat = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - last - 5));
    last = now;
  }, 5);
  await flush();
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  try {
    const value = await action();
    const wallMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return {
      value,
      wallMs: round(wallMs),
      cpuMs: round((cpu.user + cpu.system) / 1000),
      heartbeatMaxLagMs: round(Math.max(0, ...lags)),
    };
  } finally {
    clearInterval(heartbeat);
  }
}

async function child(engine: Engine, size: number, rounds: number) {
  const startupRss = process.memoryUsage().rss;
  const moduleStart = performance.now();
  const factory =
    engine === "ts"
      ? undefined
      : (await import("@nervekit/native")).createFileCompletionIndex;
  const moduleLoadMs = performance.now() - moduleStart;
  await collect();
  const readyRss = process.memoryUsage().rss;
  let candidates: FileCompletionCandidate[] = [];
  let metadata: Array<Pick<FileCompletionCandidate, "relativePath" | "kind">> =
    [];
  let index: FileCompletionIndex | undefined;
  let service: FileCompletionService | undefined;
  let candidateBuildMs = 0;
  let indexBuildMs = 0;
  let indexBuildHeartbeatMaxLagMs = 0;
  const discover = async () => {
    const start = performance.now();
    const input = variedCompletionCandidates(size);
    candidateBuildMs += performance.now() - start;
    return input;
  };
  const create = async (input: readonly FileCompletionCandidate[]) => {
    assert.ok(factory);
    const built = await measure(() => factory(input));
    indexBuildMs += built.wallMs;
    indexBuildHeartbeatMaxLagMs = Math.max(
      indexBuildHeartbeatMaxLagMs,
      built.heartbeatMaxLagMs,
    );
    return built.value;
  };
  const complete = (
    query: string,
  ): CompletionItem[] | Promise<CompletionItem[]> => {
    if (engine === "ts") return optimized(candidates, query);
    if (engine === "service") {
      assert.ok(service);
      return service.completeFiles("synthetic", query);
    }
    assert.ok(index);
    return index.query(query).then((matches) =>
      matches.map((match) => {
        const item = metadata[match.candidateIndex]!;
        return toCompletionItem({
          candidate: candidateFromPath(item.relativePath, item.kind),
          score: match.score,
          matchRanges: match.matchRanges,
        });
      }),
    );
  };
  const cold = await measure(async () => {
    if (engine === "service") {
      service = new FileCompletionService(
        () => ({
          id: "synthetic",
          name: "synthetic",
          directory: "/synthetic/no-filesystem-access",
          createdAt: "",
          updatedAt: "",
        }),
        { discover, createIndex: create },
      );
    } else {
      candidates = await discover();
      if (engine === "native") {
        index = await create(candidates);
        metadata = candidates.map(({ relativePath, kind }) => ({
          relativePath,
          kind,
        }));
        candidates = [];
      }
    }
    return complete("Composer");
  });
  await collect();
  const retained = process.memoryUsage();
  // Query definitions need only a tiny deterministic fixture; constructing a
  // second full graph would contaminate the native/service RSS comparison.
  // Deep target uses the same last deepest path as the full dataset, passed in
  // by the parent (below), while all other probes are size-independent.
  const workload = JSON.parse(
    process.env.COMPLETION_BENCH_WORKLOAD ?? "null",
  ) as ReturnType<typeof completionWorkload> | null;
  assert.ok(workload);
  const outputs: CompletionItem[][] = [];
  const probes: Array<{
    query: string;
    category: string;
    p50: number;
    p95: number;
  }> = [];
  const warm = await measure(async () => {
    const samples = workload.probes.map(() => [] as number[]);
    for (const [position, probe] of workload.probes.entries())
      outputs[position] = await complete(probe.query);
    for (let cycle = 0; cycle < rounds; cycle += 1)
      for (const [position, probe] of workload.probes.entries()) {
        const start = performance.now();
        await complete(probe.query);
        samples[position]!.push(performance.now() - start);
      }
    for (const [position, probe] of workload.probes.entries())
      probes.push({ ...probe, ...quantiles(samples[position]!) });
  });
  const streams = [];
  for (const scenario of ["paced", "burst"] as const)
    for (const policy of ["fifo", "latest-pending"] as const) {
      streams.push({
        scenario,
        policy,
        ...(await scheduleCompletionWorkload(
          workload[scenario],
          complete,
          policy,
        )),
      });
    }
  const afterQueriesRss = process.memoryUsage().rss;
  const close = await measure(async () => {
    if (service) await service.dispose();
    if (index) await index.close();
    service = undefined;
    index = undefined;
    candidates = [];
    metadata = [];
  });
  const beforeGcRss = process.memoryUsage().rss;
  const gcStart = performance.now();
  await collect();
  const postCloseGcMs = performance.now() - gcStart;
  const afterClose = process.memoryUsage();
  return {
    engine,
    size,
    rounds,
    moduleLoadMs: round(moduleLoadMs),
    candidateBuildMs: round(candidateBuildMs),
    indexBuildMs: round(indexBuildMs),
    indexBuildHeartbeatMaxLagMs,
    coldFirstComplete: {
      wallMs: cold.wallMs,
      cpuMs: cold.cpuMs,
      heartbeatMaxLagMs: cold.heartbeatMaxLagMs,
    },
    warm: {
      wallMs: warm.wallMs,
      cpuMs: warm.cpuMs,
      heartbeatMaxLagMs: warm.heartbeatMaxLagMs,
      probes,
    },
    streams,
    close: {
      wallMs: close.wallMs,
      cpuMs: close.cpuMs,
      heartbeatMaxLagMs: close.heartbeatMaxLagMs,
    },
    memory: {
      startupRss,
      readyRss,
      retainedRss: retained.rss,
      retainedHeap: retained.heapUsed,
      afterQueriesRss,
      beforeGcRss,
      afterCloseRss: afterClose.rss,
      afterCloseHeap: afterClose.heapUsed,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      postCloseGcMs: round(postCloseGcMs),
    },
    outputs,
    coldOutput: cold.value,
  };
}

async function main() {
  const rounds = Number(process.env.COMPLETION_BENCH_ROUNDS ?? 9);
  const sizes = (process.env.COMPLETION_BENCH_SIZES ?? "1000,20000,100000")
    .split(",")
    .map(Number);
  assert.ok(
    Number.isInteger(rounds) &&
      rounds > 0 &&
      sizes.every((size) => Number.isInteger(size) && size > 0),
  );
  console.log(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      rounds,
      sizes,
      isolated: true,
      forcedGc: true,
      heartbeatMs: 5,
    }),
  );
  for (const size of sizes) {
    // Parent-only workload generation does not affect child RSS or cold timing.
    const workload = completionWorkload(variedCompletionCandidates(size));
    const results: Awaited<ReturnType<typeof child>>[] = [];
    for (const engine of ["ts", "native", "service"] as const) {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--expose-gc",
          "--import",
          "tsx",
          fileURLToPath(import.meta.url),
          "--child",
          engine,
          String(size),
          String(rounds),
        ],
        {
          cwd: process.cwd(),
          maxBuffer: 16 * 1024 * 1024,
          env: {
            ...process.env,
            COMPLETION_BENCH_WORKLOAD: JSON.stringify(workload),
          },
        },
      );
      results.push(JSON.parse(stdout) as Awaited<ReturnType<typeof child>>);
    }
    for (const result of results) {
      assert.deepEqual(
        result.outputs,
        results[0]!.outputs,
        `${size} ${result.engine} warm output parity`,
      );
      assert.deepEqual(
        result.coldOutput,
        results[0]!.coldOutput,
        `${size} ${result.engine} cold output parity`,
      );
      console.log(
        JSON.stringify({
          ...result,
          outputs: undefined,
          coldOutput: undefined,
          parity: true,
        }),
      );
    }
  }
}

if (process.argv[2] === "--child") {
  const engine = process.argv[3] as Engine;
  assert.ok(["ts", "native", "service"].includes(engine));
  console.log(
    JSON.stringify(
      await child(engine, Number(process.argv[4]), Number(process.argv[5])),
    ),
  );
} else if (process.argv[1]?.endsWith("file-completion-native.benchmark.ts"))
  await main();
