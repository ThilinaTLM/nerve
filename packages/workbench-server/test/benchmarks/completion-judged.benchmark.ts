// Synthetic only. Measures the retained native lexical API, not live providers,
// filesystem discovery, direct directory listing, network, or renderer latency.
import { performance } from "node:perf_hooks";
import { createFileCompletionIndex } from "@nervekit/native";
import { candidateFromPath } from "../../src/domains/completions/file-completion-candidates.js";
import {
  completionJudgments,
  judgedPaths,
  rankingMetrics,
} from "./completion-judgments.js";

import {
  adversarialJudgments,
  adversarialPaths,
} from "./completion-adversarial-judgments.js";

const adversarial = process.argv.includes("--adversarial");
const judgments = adversarial ? adversarialJudgments : completionJudgments;
const paths = adversarial ? [...judgedPaths, ...adversarialPaths] : judgedPaths;
const candidates = paths.map((path) =>
  candidateFromPath(path, path.endsWith("/src") ? "directory" : "file"),
);
for (let i = 0; i < 2000; i++)
  candidates.push(
    candidateFromPath(`synthetic/module-${i}/src/controller-${i}.ts`, "file"),
  );
const beforeRss = process.memoryUsage().rss;
const start = performance.now();
const index = await createFileCompletionIndex(candidates);
const buildMs = performance.now() - start;
try {
  const ranks: number[] = [];
  const times: number[] = [];
  const results = [];
  for (const judgment of judgments) {
    // Deliberately do not strip typed prefixes: this is the pre-integration
    // baseline. Unsupported source intent is a miss, not excluded from totals.
    const matches = await index.query(judgment.query, { limit: 8 });
    const rank =
      matches.findIndex(
        (match) =>
          candidates[match.candidateIndex]?.relativePath === judgment.expected,
      ) + 1;
    ranks.push(rank);
    results.push({ ...judgment, rank });
  }
  for (let round = 0; round < 9; round++) {
    for (const judgment of judgments) {
      const begin = performance.now();
      await index.query(judgment.query, { limit: 8 });
      times.push(performance.now() - begin);
    }
  }
  times.sort((a, b) => a - b);
  const byCategory = Object.fromEntries(
    [...new Set(judgments.map((q) => q.category))].map((category) => [
      category,
      rankingMetrics(
        results.filter((q) => q.category === category).map((q) => q.rank),
      ),
    ]),
  );
  console.log(
    JSON.stringify(
      {
        synthetic: true,
        mode: adversarial ? "adversarial" : "original-baseline",
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        candidates: candidates.length,
        buildMs,
        rssDeltaBytes: process.memoryUsage().rss - beforeRss,
        metrics: rankingMetrics(ranks),
        byCategory,
        warmQueryMs: {
          samples: times.length,
          p50: times[Math.floor(times.length * 0.5)],
          p95: times[Math.floor(times.length * 0.95)],
        },
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await index.close();
}
