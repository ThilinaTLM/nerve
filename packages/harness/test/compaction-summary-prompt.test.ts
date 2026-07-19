import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isStructuredCompactionSummary,
  missingCompactionSummaryHeadings,
  SUMMARIZATION_PROMPT,
  UPDATE_SUMMARIZATION_PROMPT,
} from "../src/harness/compaction/compaction.js";

const structuredSummary = `## Goal
Ship compaction.

## Requirements and Constraints
- Preserve state.

## Work Completed
- [x] Added policy.

## Work Remaining
- [ ] Add orchestration.

## Key Decisions
- **Boundary**: Compact between iterations.

## Current Working State
- Tests are pending.

## Continuation Plan
1. Finish orchestration.

## Critical References
- packages/harness/src/harness/compaction/compaction.ts`;

describe("compaction summary handover prompt", () => {
  it("emphasizes completed work, remaining work, and exact continuation", () => {
    assert.match(SUMMARIZATION_PROMPT, /avoid redoing/i);
    assert.match(SUMMARIZATION_PROMPT, /remaining work exhaustive/i);
    assert.match(SUMMARIZATION_PROMPT, /Current Working State/);
    assert.match(SUMMARIZATION_PROMPT, /Continuation Plan/);
    assert.match(SUMMARIZATION_PROMPT, /Do not answer questions or continue/i);
  });

  it("requires previous checkpoints to retain unfinished work honestly", () => {
    assert.match(UPDATE_SUMMARIZATION_PROMPT, /Move an item.*only when/i);
    assert.match(UPDATE_SUMMARIZATION_PROMPT, /Keep partial work/i);
    assert.match(
      UPDATE_SUMMARIZATION_PROMPT,
      /neither repeats completed steps nor loses unfinished ones/i,
    );
  });

  it("validates every required handover section", () => {
    assert.equal(isStructuredCompactionSummary(structuredSummary), true);
    assert.deepEqual(missingCompactionSummaryHeadings(structuredSummary), []);
    assert.equal(
      isStructuredCompactionSummary(
        structuredSummary.replace("## Work Remaining", "## Later"),
      ),
      false,
    );
  });
});
