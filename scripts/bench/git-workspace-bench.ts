/**
 * Times the Git reads behind the multi-repository workspace: project discovery
 * (including linked worktrees), per-repository summary reads and per-repository
 * overview (status) reads, sequentially and with concurrency 2 and 4.
 *
 *   pnpm exec tsx scripts/bench/git-workspace-bench.ts <projectDir> [rounds]
 *
 * Needs the native module for this platform. If it is missing or stale:
 *   pnpm --filter @nervekit/native build && pnpm --filter @nervekit/native build:native
 * Read-only: nothing in <projectDir> is modified.
 */
import { resolve } from "node:path";
import { GitService } from "../../packages/tools/src/git/git-service.ts";

const PROJECT_ID = "proj_bench";
const projectDir = process.argv[2] ? resolve(process.argv[2]) : "";
const rounds = Math.max(1, Number(process.argv[3] ?? 5) || 5);
if (!projectDir) {
  console.error(
    "usage: pnpm exec tsx scripts/bench/git-workspace-bench.ts <projectDir> [rounds]",
  );
  process.exit(2);
}

const service = GitService.forWorkspace(projectDir, "bench");

type Row = {
  operation: string;
  mode: string;
  calls: number;
  min: number;
  median: number;
  max: number;
  wall: number;
};
const rows: Row[] = [];

const now = () => performance.now();
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

async function timed<T>(work: () => Promise<T>): Promise<[number, T]> {
  const start = now();
  const value = await work();
  return [now() - start, value];
}

/** Runs `task` for every item with at most `limit` in flight; returns per-call and wall times. */
async function pool<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<unknown>,
) {
  const durations: number[] = [];
  let next = 0;
  const wallStart = now();
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        durations.push((await timed(() => task(item)))[0]);
      }
    }),
  );
  return { durations, wall: now() - wallStart };
}

function record(
  operation: string,
  mode: string,
  durations: number[],
  walls: number[],
) {
  rows.push({
    operation,
    mode,
    calls: durations.length,
    min: Math.min(...durations),
    median: median(durations),
    max: Math.max(...durations),
    wall: median(walls),
  });
}

// 1. Discovery (refresh = true bypasses the project read cache).
const discoveryTimes: number[] = [];
let repos = (await service.discoverRepos(PROJECT_ID, true)).repos;
for (let i = 0; i < rounds; i++) {
  const [ms, result] = await timed(() =>
    service.discoverRepos(PROJECT_ID, true),
  );
  discoveryTimes.push(ms);
  repos = result.repos;
}
record("discovery", "-", discoveryTimes, discoveryTimes);

const groups = new Set(repos.map((repo) => repo.worktreeGroup));
console.log(
  `project: ${projectDir}\n${repos.length} checkouts in ${groups.size} repositories (${repos.filter((r) => !r.primaryWorktree).length} linked worktrees)\n`,
);

// 2. Per-repository reads, cold (caches dropped before each call).
const operations: Array<[string, (rel: string) => Promise<unknown>]> = [
  [
    // Previous summary tier: a full snapshot (metadata + status) per repository.
    "summary (full snapshot)",
    (rel) => {
      const repo = repos.find((r) => r.relativePath === rel)!;
      service.invalidateStableRepoMetadata(repo.absDir);
      return service.summarizeRepo(repo.absDir, repo.relativePath, repo.name);
    },
  ],
  [
    // Summary tier now: status only plus cached stable metadata.
    "summary (repoSummary)",
    (rel) => {
      const repo = repos.find((r) => r.relativePath === rel)!;
      service.invalidateStableRepoMetadata(repo.absDir);
      return service.repoSummary(PROJECT_ID, rel);
    },
  ],
  [
    // Steady state: stable metadata cached, as between monitor notices.
    "summary (repoSummary, warm)",
    (rel) => service.repoSummary(PROJECT_ID, rel),
  ],
  [
    "overview",
    (rel) => {
      const repo = repos.find((r) => r.relativePath === rel)!;
      service.invalidateStableRepoMetadata(repo.absDir);
      return service.overview(PROJECT_ID, rel);
    },
  ],
];
const paths = repos.map((repo) => repo.relativePath);
for (const [operation, run] of operations) {
  for (const limit of [1, 2, 4]) {
    const durations: number[] = [];
    const walls: number[] = [];
    for (let i = 0; i < rounds; i++) {
      const result = await pool(paths, limit, run);
      durations.push(...result.durations);
      walls.push(result.wall);
    }
    record(
      operation,
      limit === 1 ? "sequential" : `concurrency ${limit}`,
      durations,
      walls,
    );
  }
}

// 3. Table. min/median/max are per call; "wall" is the median time to finish all checkouts.
const header = [
  "operation",
  "mode",
  "calls",
  "min ms",
  "median ms",
  "max ms",
  "wall ms (all)",
];
const body = rows.map((row) => [
  row.operation,
  row.mode,
  String(row.calls),
  row.min.toFixed(1),
  row.median.toFixed(1),
  row.max.toFixed(1),
  row.wall.toFixed(1),
]);
const widths = header.map((h, i) =>
  Math.max(h.length, ...body.map((r) => r[i].length)),
);
const line = (cells: string[]) =>
  cells
    .map((c, i) => (i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i])))
    .join("  ");
console.log(line(header));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of body) console.log(line(row));

process.exit(0);
