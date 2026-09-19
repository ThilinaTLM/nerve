import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunStatusNotice } from "../../state/transcript-types";
import { runStatusNoticeModel } from "./run-status-notice";

const nowMs = Date.parse("2026-01-01T00:00:00.000Z");

function notice(overrides: Partial<RunStatusNotice> = {}): RunStatusNotice {
  return { state: "failed", runId: "run_1", ...overrides };
}

describe("run status notice model", () => {
  it("counts down a pending retry in chips, not prose", () => {
    const model = runStatusNoticeModel(
      notice({
        state: "retrying",
        retryAt: "2026-01-01T00:00:03.000Z",
        attempt: 2,
        maxRetries: 5,
        errorMessage: "503 overloaded",
      }),
      { nowMs },
    );
    assert.equal(model.badge, "run retrying");
    assert.equal(model.tone, "info");
    assert.equal(model.busy, true);
    assert.equal(model.arg, "503 overloaded");
    assert.deepEqual(
      model.chips?.map((chip) => chip.text),
      ["retry in 3s", "retry 2/5"],
    );
  });

  it("collapses an elapsed retry deadline to 'retrying now'", () => {
    const model = runStatusNoticeModel(
      notice({ state: "retrying", retryAt: "2025-12-31T23:59:59.000Z" }),
      { nowMs },
    );
    assert.equal(model.chips?.[0]?.text, "retrying now");
  });

  it("marks a failed run destructive and wires Continue when offered", () => {
    let continued = 0;
    const model = runStatusNoticeModel(notice({ attempt: 3 }), {
      nowMs,
      onContinue: () => {
        continued += 1;
      },
    });
    assert.equal(model.tone, "destructive");
    assert.equal(model.badge, "run failed");
    assert.deepEqual(
      model.chips?.map((chip) => chip.text),
      ["retry 3"],
    );
    model.action?.onClick();
    assert.equal(continued, 1);
  });

  it("treats an interrupted run as a warning without an action by default", () => {
    const model = runStatusNoticeModel(notice({ state: "interrupted" }), {
      nowMs,
    });
    assert.equal(model.tone, "warning");
    assert.equal(model.badge, "run interrupted");
    assert.match(model.summary ?? "", /Continue/);
    assert.equal(model.glyph, "bell-dot");
    assert.equal(model.action, undefined);
  });
});
