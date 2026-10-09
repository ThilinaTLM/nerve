import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentHarness } from "@nervekit/harness";
import type { CompactionOutcome } from "../../../src/domains/conversations/operations/compaction-service.js";
import { installIterationCompaction } from "../../../src/domains/agents/execution/iteration-compaction.js";

type Boundary = Extract<
  Parameters<Parameters<AgentHarness["subscribe"]>[0]>[0],
  { type: "iteration_boundary" }
>;

function fixture(
  outcome: CompactionOutcome,
  followUp: string | null = "continue",
) {
  let handler: (event: Boundary) => Promise<unknown>;
  const signals: Array<AbortSignal | undefined> = [];
  let continuations = 0;
  installIterationCompaction(
    {
      on: (_type: unknown, callback: typeof handler) => {
        handler = callback;
      },
    } as never,
    async (signal) => {
      signals.push(signal);
      return outcome;
    },
    () => {
      continuations++;
      return followUp ?? undefined;
    },
  );
  const signal = new AbortController().signal;
  return {
    signals,
    signal,
    continuations: () => continuations,
    boundary: (hasMoreToolCalls = false, toolCall = false) =>
      handler!({
        type: "iteration_boundary",
        signal,
        hasMoreToolCalls,
        message: {
          content: toolCall
            ? [{ type: "toolCall" }]
            : [{ type: "text", text: "done" }],
        },
      } as Boundary),
  };
}

it("waits for a complete tool batch before compacting", async () => {
  const f = fixture({ status: "compacted", reason: "checkpoint_committed" });
  assert.equal(await f.boundary(true, true), undefined);
  assert.deepEqual(f.signals, []);
  assert.equal(f.continuations(), 0);
  assert.equal(await f.boundary(false, true), undefined);
  assert.deepEqual(f.signals, [f.signal]);
  assert.equal(f.continuations(), 0);
});

for (const outcome of [
  { status: "not_needed", reason: "below_threshold" },
  { status: "deferred", reason: "pending_work" },
  { status: "blocked", reason: "pending_work" },
  { status: "failed", reason: "summary_failed" },
  { status: "cancelled", reason: "aborted" },
] as const) {
  it(`does not continue after ${outcome.status} compaction`, async () => {
    const f = fixture(outcome);
    assert.equal(await f.boundary(), undefined);
    assert.equal(f.continuations(), 0);
  });
}

it("requests a follow-up only for a compacted final response with allowance remaining", async () => {
  const f = fixture({ status: "compacted", reason: "checkpoint_committed" });
  assert.deepEqual(await f.boundary(), { followUp: "continue" });
  assert.equal(f.continuations(), 1);
  const exhausted = fixture(
    { status: "compacted", reason: "checkpoint_committed" },
    null,
  );
  assert.equal(await exhausted.boundary(), undefined);
});
