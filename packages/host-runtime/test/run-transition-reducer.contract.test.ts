import assert from "node:assert/strict";
import test from "node:test";
import type { RunTransitionRecord } from "@nervekit/contracts";
import {
  reduceRunTransitions,
  RunRevisionConflictError,
} from "../src/index.js";
import { checksum } from "./test-checksum.js";

test("reducer rejects a gap in transition revisions", () => {
  const base = {
    stateEpoch: 1 as const,
    runId: "run_x",
    scopeId: "scope",
    kind: "started",
    committedAt: "2026-07-12T00:00:00.000Z",
    prompts: [],
    interactions: [],
    checkpoints: [],
    entries: [],
    toolCalls: [],
    events: [],
    checksum: checksum({}),
  };
  const transitions = [
    {
      ...base,
      transitionId: "transition_1",
      revision: 1,
      previousRevision: 0,
      run: { revision: 1 },
    },
    {
      ...base,
      transitionId: "transition_3",
      revision: 3,
      previousRevision: 2,
      run: { revision: 3 },
    },
  ] as unknown as RunTransitionRecord[];
  assert.throws(
    () => reduceRunTransitions(transitions),
    RunRevisionConflictError,
  );
});
