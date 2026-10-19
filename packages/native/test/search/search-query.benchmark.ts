// Synthetic release-addon queries: per-query + burst timing at actual retrieval budgets.
// Never overwrite the preserved pre-optimization logs. Run variants serially.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as Native from "../../src/search/index.js";

const texts = ["Com", "Composer", "src/Com", "project-3/Composer", "İst"];
function candidate(i: number, changed = false) {
  const relativePath = `packages/project-${i % 19}/src/${changed ? "Updated" : ""}${i % 97 === 0 ? "İstanbul" : "Composer"}Item${i}.ts`;
  const segments = relativePath.split("/"),
    name = segments.at(-1)!;
  return {
    relativePath,
    segments,
    name,
    stem: name.slice(0, -3),
    depth: segments.length,
    kind: "file" as const,
  };
}
const document = (i: number, changed = false) => ({
  id: `file:${i}`,
  kind: "file",
  fields: [{ key: "path" as const, text: candidate(i, changed).relativePath }],
});

async function trial(
  count: number,
  label: string,
  modulePath: string,
  limits: number[],
  trialNumber: number,
  rounds: number,
) {
  const native = (await import(
    pathToFileURL(resolve(modulePath)).href
  )) as typeof Native;
  let lag = 0,
    last = performance.now();
  const heartbeat = setInterval(() => {
    const now = performance.now();
    lag = Math.max(lag, now - last - 1);
    last = now;
  }, 1);
  await pause(10);
  const measure = async <T>(run: () => Promise<T>) => {
    lag = 0;
    last = performance.now();
    const start = last,
      value = await run(),
      ms = performance.now() - start;
    await pause(5);
    return { value, ms, lag };
  };
  globalThis.gc?.();
  const startRss = process.memoryUsage().rss;
  let typed: Native.SearchIndex;
  const build = await measure(async () => {
    typed = await native.createSearchIndex();
    await typed.update({
      upsert: Array.from({ length: count }, (_, i) => document(i)),
      remove: [],
    });
  });
  globalThis.gc?.();
  const retainedRss = process.memoryUsage().rss;
  const query = (text: string, limit: number): Promise<Native.SearchResult> =>
    typed.query({ text, limit });
  // Untimed warmup for each budget. Limit order rotates across isolated trials.
  const orderedLimits = limits.map(
    (_, i) => limits[(i + trialNumber) % limits.length]!,
  );
  for (const limit of orderedLimits)
    for (const text of texts) await query(text, limit);
  const queries = [],
    bursts = [];
  for (let round = 0; round < rounds; round++) {
    for (const limit of orderedLimits) {
      for (let j = 0; j < texts.length; j++) {
        const text = texts[(j + round) % texts.length]!;
        const measured = await measure(() => query(text, limit));
        // Hash outside timed query/heartbeat phase; compare exact outputs across builds.
        const digest = createHash("sha256")
          .update(JSON.stringify(measured.value))
          .digest("hex");
        const returned = measured.value.items.length;
        queries.push({
          text,
          limit,
          round,
          ms: measured.ms,
          lag: measured.lag,
          returned,
          digest,
        });
      }
      const burst = await measure(async () => {
        for (const text of texts) await query(text, limit);
      });
      bursts.push({ limit, round, ms: burst.ms, lag: burst.lag });
    }
  }
  const update = await measure(async () => {
    await typed.update({
      upsert: Array.from({ length: 100 }, (_, i) => document(i, true)),
      remove: [],
    });
  });
  globalThis.gc?.();
  const updatedRss = process.memoryUsage().rss;
  const dispose = await measure(() => typed.close());
  globalThis.gc?.();
  clearInterval(heartbeat);
  return {
    label,
    mode: "typed",
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    count,
    trial: trialNumber,
    limits,
    rounds,
    startRss,
    retainedRss,
    updatedRss,
    disposedRss: process.memoryUsage().rss,
    buildMs: build.ms,
    buildLag: build.lag,
    updateMs: update.ms,
    updateLag: update.lag,
    disposeMs: dispose.ms,
    disposeLag: dispose.lag,
    queries,
    bursts,
  };
}
if (process.argv[2] === "--child") {
  console.log(
    JSON.stringify(
      await trial(
        Number(process.argv[3]),
        process.argv[4]!,
        process.argv[5]!,
        process.argv[6]!.split(",").map(Number),
        Number(process.argv[7]),
        Number(process.argv[8]),
      ),
    ),
  );
} else {
  const label = process.argv[2] ?? "unlabelled",
    output = process.argv[3] ?? `/tmp/nerve-search-query-${label}.jsonl`,
    modulePath = process.argv[4] ?? "src/search/index.ts",
    limits = process.argv[5] ?? "8,64,256";
  const pilot = process.argv[6] === "--pilot";
  const rows = [];
  for (const count of pilot ? [100000] : [20000, 100000]) {
    for (let i = 0; i < (pilot ? 1 : 9); i++) {
      const child = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          "--import",
          "tsx",
          fileURLToPath(import.meta.url),
          "--child",
          String(count),
          label,
          modulePath,
          limits,
          String(i),
          String(pilot ? 3 : 9),
        ],
        { encoding: "utf8" },
      );
      if (child.status !== 0)
        throw new Error(child.stderr || `Child failed: ${child.status}`);
      rows.push(child.stdout.trim());
    }
  }
  writeFileSync(output, rows.join("\n") + "\n");
  console.log(
    `Wrote ${rows.length} isolated ${pilot ? "pilot" : "nine-trial"} results to ${output}`,
  );
}
