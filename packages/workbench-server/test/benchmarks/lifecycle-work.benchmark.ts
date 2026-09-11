import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CanonicalStore } from "../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

if (process.env.NERVE_LIFECYCLE_BENCHMARK !== "1") {
  console.log(
    "Set NERVE_LIFECYCLE_BENCHMARK=1 to run this isolated benchmark.",
  );
  process.exit(0);
}

const count = Number(process.env.NERVE_LIFECYCLE_BENCHMARK_COUNT ?? 1_000);
const home = await mkdtemp(join(tmpdir(), "nerve-lifecycle-benchmark-"));
const databasePath = join(home, "data", "nerve.sqlite");
const store = new CanonicalStore(databasePath);
try {
  await store.initialize();
  const database = new DatabaseSync(databasePath);
  const insert = database.prepare(`INSERT INTO lifecycle_work (
    id, deduplication_key, conversation_id, run_id, proposal_id, kind, state,
    input_hash, generation, attempt_count, not_before_ms, created_at_ms,
    updated_at_ms, payload_version, data
  ) VALUES (?, ?, ?, ?, ?, 'execute_tool', 'ready', ?, 0, 0, 0, 0, 0, 1, ?)`);
  database.exec("BEGIN IMMEDIATE");
  for (let index = 0; index < count; index += 1) {
    const id = `work_benchmark_${index}`;
    const data = Buffer.from(
      JSON.stringify({
        id,
        deduplicationKey: `benchmark:${index}`,
        conversationId: "conv_benchmark",
        runId: "run_benchmark",
        proposalId: `tool_benchmark_${index}`,
        kind: "execute_tool",
        state: "ready",
        inputHash: `sha256:${"a".repeat(64)}`,
        generation: 0,
        attemptCount: 0,
        notBefore: "1970-01-01T00:00:00.000Z",
        createdAt: "1970-01-01T00:00:00.000Z",
        updatedAt: "1970-01-01T00:00:00.000Z",
      }),
    );
    insert.run(
      id,
      `benchmark:${index}`,
      "conv_benchmark",
      "run_benchmark",
      `tool_benchmark_${index}`,
      `sha256:${"a".repeat(64)}`,
      data,
    );
  }
  database.exec("COMMIT");
  database.close();

  const started = performance.now();
  const claimLatencies: number[] = [];
  const settlementLatencies: number[] = [];
  let completed = 0;
  while (completed < count) {
    const due = await store.listDueLifecycleWork(
      "2026-01-01T00:00:00.000Z",
      Math.min(64, count - completed),
    );
    for (const candidate of due) {
      const claimStarted = performance.now();
      const work = await store.claimLifecycleWork({
        workId: candidate.id,
        expectedGeneration: candidate.generation,
        leaseOwner: "benchmark_worker",
        now: "2026-01-01T00:00:00.000Z",
        leaseDeadline: "2026-01-01T00:01:00.000Z",
      });
      claimLatencies.push(performance.now() - claimStarted);
      if (!work) continue;
      const settlementStarted = performance.now();
      await store.settleLifecycleWork({
        workId: work.id,
        expectedGeneration: work.generation,
        leaseOwner: "benchmark_worker",
        state: "succeeded",
        now: "2026-01-01T00:00:01.000Z",
      });
      settlementLatencies.push(performance.now() - settlementStarted);
      completed += 1;
    }
  }
  const durationMs = performance.now() - started;
  const result = {
    count,
    durationMs,
    operationsPerSecond: (count / durationMs) * 1_000,
    averageClaimAndSettleMs: durationMs / count,
    claimP95Ms: percentile(claimLatencies, 0.95),
    settlementP95Ms: percentile(settlementLatencies, 0.95),
    walBytes: await stat(`${databasePath}-wal`)
      .then((value) => value.size)
      .catch(() => 0),
  };
  const artifactDir =
    process.env.NERVE_BENCHMARK_ARTIFACT_DIR ??
    join(tmpdir(), "nerve-benchmarks");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    join(artifactDir, "lifecycle-work-benchmark.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result));
} finally {
  await store.close().catch(() => undefined);
  await rm(home, { recursive: true, force: true });
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}
