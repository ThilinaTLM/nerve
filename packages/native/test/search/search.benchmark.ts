// Synthetic whole-public-API benchmark. Isolated subprocesses, never a unit suite.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";
import type { SearchIndex } from "../../src/index.js";
import type * as Current from "../../src/index.js";

const candidate = (i: number, changed = false) => {
  const relativePath = `packages/project-${i % 19}/src/${changed ? "Updated" : ""}${i % 97 === 0 ? "İstanbul" : "Composer"}Item${i}.ts`;
  const segments = relativePath.split("/");
  const name = segments.at(-1)!;
  return {
    relativePath,
    segments,
    name,
    stem: name.slice(0, -3),
    depth: segments.length,
    kind: "file" as const,
  };
};
const document = (i: number, changed = false) => ({
  id: `file:${i}`,
  kind: "file",
  fields: [{ key: "path" as const, text: candidate(i, changed).relativePath }],
});

async function trial(count: number, label: string, modulePath?: string) {
  const native: typeof Current = await import(
    modulePath
      ? pathToFileURL(resolve(modulePath)).href
      : new URL("../../src/index.ts", import.meta.url).href
  );
  let maximumLag = 0,
    last = performance.now();
  const heartbeat = setInterval(() => {
    const now = performance.now();
    maximumLag = Math.max(maximumLag, now - last - 1);
    last = now;
  }, 1);
  await pause(10);
  const measure = async <T>(run: () => Promise<T>) => {
    maximumLag = 0;
    last = performance.now();
    const start = last,
      value = await run(),
      ms = performance.now() - start;
    await pause(5);
    return { value, ms, lag: maximumLag };
  };
  globalThis.gc?.();
  const startRss = process.memoryUsage().rss;
  let searchIndex: SearchIndex;
  const build = await measure(async () => {
    searchIndex = await native.createSearchIndex();
    await searchIndex.update({
      upsert: Array.from({ length: count }, (_, i) => document(i)),
      remove: [],
    });
  });
  globalThis.gc?.();
  const retainedRss = process.memoryUsage().rss;
  const queries = [];
  for (let round = 0; round < 9; round++) {
    const query = await measure(async () => {
      for (const text of [
        "Com",
        "Composer",
        "src/Com",
        "project-3/Composer",
        "İst",
      ]) {
        await searchIndex.query({ text, limit: 8 });
      }
    });
    queries.push({ ms: query.ms, lag: query.lag });
  }
  let updatePeakRss = retainedRss;
  const update = await measure(async () => {
    await searchIndex.update({
      upsert: Array.from({ length: 100 }, (_, i) => document(i, true)),
      remove: [],
    });
    updatePeakRss = Math.max(updatePeakRss, process.memoryUsage().rss);
  });
  globalThis.gc?.();
  const updatedRss = process.memoryUsage().rss;
  const dispose = await measure(() => searchIndex.close());
  globalThis.gc?.();
  clearInterval(heartbeat);
  return {
    label,
    mode: "typed",
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    count,
    startRss,
    retainedRss,
    updatedRss,
    updatePeakRss,
    disposedRss: process.memoryUsage().rss,
    buildMs: build.ms,
    buildLag: build.lag,
    queries,
    updateMs: update.ms,
    updateLag: update.lag,
    disposeMs: dispose.ms,
    disposeLag: dispose.lag,
  };
}

if (process.argv[2] === "--child") {
  console.log(
    JSON.stringify(
      await trial(Number(process.argv[3]), process.argv[4]!, process.argv[5]),
    ),
  );
} else {
  const label = process.argv[2] ?? "unlabelled";
  const output = process.argv[3] ?? `/tmp/nerve-search-${label}.jsonl`;
  const modulePath = process.argv[4];
  const rows = [];
  for (const count of [20_000, 100_000]) {
    for (let round = 0; round < 9; round++) {
      const result = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          "--import",
          "tsx",
          fileURLToPath(import.meta.url),
          "--child",
          String(count),
          label,
          ...(modulePath ? [modulePath] : []),
        ],
        { encoding: "utf8" },
      );
      if (result.status !== 0)
        throw new Error(result.stderr || `Child failed: ${result.status}`);
      rows.push(result.stdout.trim());
    }
  }
  writeFileSync(output, rows.join("\n") + "\n");
  console.log(`Wrote ${rows.length} synthetic isolated trials to ${output}`);
}
