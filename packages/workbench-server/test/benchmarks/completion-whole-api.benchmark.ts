// Synthetic unified whole-service benchmark; no workspace or user data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { SearchIndex } from "@nervekit/native";
import type { FileCompletionEntry } from "../../src/domains/completions/file-completion-candidates.js";
import { UnifiedCompletionService } from "../../src/domains/completions/unified-completion-service.js";
import {
  syntheticProviders,
  syntheticScope,
} from "./completion-synthetic-providers.js";

const self = fileURLToPath(import.meta.url);
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const names = [
  "session",
  "handler",
  "checkout",
  "utils",
  "controller",
  "service",
  "config",
  "résumé",
  "会話",
];
const queries = [...names, "module 42"];
const frozenNow = 1_800_000_000_000;
const pathAt = (i: number) =>
  `synthetic/module-${i % 200}/src/${i % 11 === 0 ? `directory-${i}` : `${names[i % names.length]}-${i}.ts`}`;
const kindAt = (i: number) =>
  i % 11 === 0 ? ("directory" as const) : ("file" as const);
const quantiles = (times: number[]) => {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
};
async function memory() {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  await turn();
  gc?.();
  return {
    ...process.memoryUsage(),
    maxRssKiB: process.resourceUsage().maxRSS,
    forcedGc: !!gc,
  };
}

async function child(count: number) {
  const home = await mkdtemp(join(tmpdir(), "completion-whole-api-"));
  const loop = monitorEventLoopDelay({ resolution: 10 });
  let last = performance.now();
  let lag = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    lag = Math.max(lag, now - last - 5);
    last = now;
  }, 5);
  loop.enable();
  const discovery = { calls: 0, candidates: 0, ms: 0 };
  const native = {
    indexes: 0,
    fileUpserts: 0,
    nonFileUpserts: 0,
    removals: 0,
    queries: 0,
    returned: 0,
  };
  let dispose: (() => Promise<void>) | undefined;
  let initial: Awaited<ReturnType<typeof memory>> | undefined;
  try {
    const rawEntries = (): FileCompletionEntry[] =>
      Array.from({ length: count }, (_, i) => ({
        relativePath: pathAt(i),
        kind: kindAt(i),
      }));
    const discoverWith =
      <T extends FileCompletionEntry>(create: () => T[]) =>
      async () => {
        discovery.calls++;
        const start = performance.now();
        const candidates = create();
        discovery.ms += performance.now() - start;
        discovery.candidates += candidates.length;
        return candidates;
      };
    const discoverRaw = discoverWith(rawEntries);
    const { createSearchIndex } = await import("@nervekit/native");
    const fixture = syntheticProviders({
      paths: [],
      allSources: true,
      discover: discoverRaw,
    });
    const service = new UnifiedCompletionService({
      home,
      providers: fixture.providers,
      now: () => frozenNow,
      authorize(scope) {
        assert.equal(scope.projectId, syntheticScope.projectId);
        assert.ok(
          scope.conversationId === syntheticScope.conversationId ||
            scope.conversationId === `${syntheticScope.conversationId}_2`,
        );
      },
      context(scope) {
        return scope.conversationId?.endsWith("_2")
          ? { editedPaths: [pathAt(12)] }
          : {};
      },
      createIndex: async () => {
        native.indexes++;
        const index: SearchIndex = await createSearchIndex();
        return {
          ...index,
          async update(input) {
            for (const document of input.upsert ?? []) {
              if (document.kind === "file" || document.kind === "directory")
                native.fileUpserts++;
              else native.nonFileUpserts++;
            }
            native.removals += input.remove?.length ?? 0;
            return index.update(input);
          },
          async query(input) {
            const ids = input.documentIds;
            assert.equal(input.limit, ids?.length ?? 64);
            if (ids) assert.ok(ids.length > 0 && ids.length <= 256);
            const result = await index.query(input);
            native.queries++;
            native.returned += result.items.length;
            return result;
          },
        };
      },
    });
    const search = async (
      q: string,
      conversationId = syntheticScope.conversationId,
    ) => {
      let result = await service.search({
        ...syntheticScope,
        conversationId,
        q,
        limit: 8,
      });
      // Includes async remote/catalog acquisition through fully fresh metadata.
      for (
        let i = 0;
        i < 8 && result.sources.some((source) => source.status === "loading");
        i++
      ) {
        await turn();
        result = await service.search({
          ...syntheticScope,
          conversationId,
          q,
          limit: 8,
        });
      }
      assert.ok(
        result.sources.every((source) => source.status === "fresh"),
        JSON.stringify(result.sources),
      );
      return result.items.length;
    };
    dispose = () => service.dispose();
    const measure = async <T>(action: () => Promise<T>) => {
      await turn();
      loop.reset();
      lag = 0;
      last = performance.now();
      const start = performance.now();
      const value = await action();
      const wallMs = performance.now() - start;
      await turn();
      return {
        value,
        wallMs,
        eventLoop: {
          samples: loop.count,
          p99Ms: loop.percentile(99) / 1e6,
          maxMs: loop.max / 1e6,
          timerLagMs: lag,
        },
      };
    };
    initial = await memory();
    const cold = await measure(() => search("session"));
    assert.ok(cold.value > 0 && cold.value <= 8);
    assert.equal(discovery.calls, 1);
    assert.equal(discovery.candidates, count);
    assert.equal(native.indexes, 1);
    assert.equal(native.fileUpserts, count);
    const afterCold = await memory();
    const times: number[] = [];
    const warm = await measure(async () => {
      for (let round = 0; round < 9; round++)
        for (const query of queries) {
          const start = performance.now();
          const visible = await search(query);
          times.push(performance.now() - start);
          assert.ok(visible > 0 && visible <= 8);
        }
    });
    const switches = await measure(async () => {
      await search("utils", `${syntheticScope.conversationId}_2`);
      await search("utils", syntheticScope.conversationId);
    });
    // Context switches must not rebuild, rediscover or copy the global file corpus.
    assert.equal(discovery.calls, 1);
    assert.equal(native.indexes, 1);
    assert.equal(native.fileUpserts, count);
    const afterWarmAndSwitch = await memory();
    const disposal = await measure(dispose);
    dispose = undefined;
    const afterDispose = await memory();
    return {
      variant: "unified",
      count,
      synthetic: true,
      platform: `${process.platform}/${process.arch}`,
      node: process.version,
      acquisition:
        "entries generated during discovery; includes index build and fresh synthetic catalogs; no filesystem or transport",
      retrieval: { main: 64, supplementalMax: 256 },
      display: 8,
      discovery,
      native,
      cold,
      warm: { ...warm, perQueryMs: quantiles(times) },
      switches,
      disposal,
      memoryBytes: { initial, afterCold, afterWarmAndSwitch, afterDispose },
      limits:
        "One cold sample per isolated process/size, synthetic fixture only; not real-user quality, cross-platform evidence, or an automated performance acceptance threshold. RSS includes process/native allocations; maxRssKiB is process lifetime high-water mark. GC is outside wall timings.",
    };
  } finally {
    loop.disable();
    clearInterval(timer);
    await dispose?.();
    await rm(home, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const validSize = (count: number) =>
  Number.isInteger(count) && count >= 100 && count <= 100_000;
if (args[0] === "--child") {
  const count = Number(args[1]);
  assert.ok(validSize(count), "size must be an integer from 100 to 100000");
  console.log(JSON.stringify(await child(count)));
} else if (args.includes("--run")) {
  const sizeArg = args.find((arg) => arg.startsWith("--sizes="));
  const sizes = sizeArg
    ? sizeArg.slice("--sizes=".length).split(",").map(Number)
    : [20_000, 100_000];
  assert.ok(
    sizes.length > 0 && sizes.every(validSize),
    "sizes must be integers from 100 to 100000",
  );
  const results = [];
  for (const count of sizes) {
    const output = await new Promise<string>((resolve, reject) => {
      const subprocess = spawn(
        process.execPath,
        ["--expose-gc", "--import", "tsx", self, "--child", String(count)],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      let stdout = "";
      subprocess.stdout.setEncoding("utf8");
      subprocess.stdout.on("data", (data: string) => {
        stdout += data;
      });
      subprocess.on("error", reject);
      subprocess.on("close", (code) =>
        code === 0
          ? resolve(stdout)
          : reject(new Error(`unified/${count} exited ${code}`)),
      );
    });
    results.push(JSON.parse(output));
  }
  console.log(JSON.stringify({ results }, null, 2));
} else
  console.log(
    "Pass --run [--sizes=20000,100000]; each size runs in an isolated subprocess.",
  );
