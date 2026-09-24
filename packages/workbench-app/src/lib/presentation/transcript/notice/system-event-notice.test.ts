import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SystemEventNotice } from "../../state/transcript-types";
import { systemEventNoticeModel } from "./system-event-notice";

function notice(overrides: Partial<SystemEventNotice>): SystemEventNotice {
  return {
    entryId: "entry_1",
    kind: "message",
    text: "Update",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("system event notices", () => {
  it("identifies branch summaries as agent context", () => {
    const model = systemEventNoticeModel(
      notice({ kind: "branch_summary", fromEntryId: "entry_previous" }),
    );
    assert.equal(model.badge, "branch_summarized");
    assert.match(model.statusLabel, /agent context/);
  });

  it("distinguishes an assignment outcome from the teammate's current state", () => {
    const model = systemEventNoticeModel(
      notice({
        kind: "subagent_run_event",
        details: {
          outcome: "failed",
          childRunId: "run_1",
          childName: "reviewer",
        },
      }),
    );
    assert.equal(model.badge, "subagent_failed");
    assert.equal(model.tone, "destructive");
    assert.equal(model.arg, "reviewer");
    assert.equal(
      model.chips?.length ?? 0,
      0,
      "run IDs remain metadata, not visible chips",
    );
  });

  it("renders unknown system messages without hiding their provenance", () => {
    const model = systemEventNoticeModel(
      notice({ details: { type: "future_event" } }),
    );
    assert.equal(model.badge, "future_event");
  });
});
