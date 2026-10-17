import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completeFileCandidates as baseline } from "../../benchmarks/file-completion-baseline.js";
import { completeFileCandidates as optimized } from "../../benchmarks/file-completion-optimized.js";
import {
  completionWorkload,
  scheduleCompletionWorkload,
  variedCompletionCandidates,
} from "../../benchmarks/file-completion-workload.benchmark.js";

describe("synthetic completion workload", () => {
  it("is deterministic, varies depth, and preserves TS parity for every stream query", () => {
    const candidates = variedCompletionCandidates(200);
    assert.deepEqual(candidates, variedCompletionCandidates(200));
    assert.ok(candidates.some((candidate) => candidate.depth <= 5));
    assert.ok(candidates.some((candidate) => candidate.depth >= 11));
    const workload = completionWorkload(candidates);
    for (const { query } of [
      ...workload.probes,
      ...workload.paced,
      ...workload.burst,
    ]) {
      assert.deepEqual(
        optimized(candidates, query),
        baseline(candidates, query),
        query,
      );
    }
  });

  it("serializes FIFO calls and bounds latest-pending batches", async () => {
    const events = ["Co", "Com", "Comp", "Compo"].map((query) => ({
      query,
      atMs: 0,
    }));
    for (const policy of ["fifo", "latest-pending"] as const) {
      let active = 0;
      let maxActive = 0;
      const calls: string[] = [];
      const result = await scheduleCompletionWorkload(
        events,
        async (query) => {
          active += 1;
          maxActive = Math.max(active, maxActive);
          calls.push(query);
          await new Promise<void>((resolve) => setImmediate(resolve));
          active -= 1;
          return [];
        },
        policy,
      );
      assert.equal(maxActive, 1);
      assert.equal(result.completed + result.dropped, events.length);
      if (policy === "fifo") {
        assert.deepEqual(
          calls,
          events.map((event) => event.query),
        );
        assert.equal(result.dropped, 0);
      } else {
        assert.deepEqual(calls, ["Compo"]);
        assert.equal(result.maxPending, 1);
        assert.equal(result.dropped, 3);
      }
    }
  });

  it("cleans up scheduled arrivals when a benchmark backend rejects", async () => {
    let calls = 0;
    await assert.rejects(
      scheduleCompletionWorkload(
        [
          { query: "Co", atMs: 0 },
          { query: "Comp", atMs: 10_000 },
        ],
        async () => {
          calls += 1;
          throw new Error("backend failed");
        },
        "fifo",
      ),
      /backend failed/,
    );
    assert.equal(calls, 1);
  });
});
