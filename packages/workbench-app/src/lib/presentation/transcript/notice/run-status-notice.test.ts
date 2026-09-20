import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunStatusNotice } from "../../state/transcript-types";
import { runStatusNoticeModel } from "./run-status-notice";

const nowMs = Date.parse("2026-01-01T00:00:00.000Z");

function notice(overrides: Partial<RunStatusNotice> = {}): RunStatusNotice {
  return { state: "failed", runId: "run_1", ...overrides };
}

describe("run status notice model", () => {
  it("counts down a pending retry in chips and formats its failure", () => {
    const model = runStatusNoticeModel(
      notice({
        state: "retrying",
        retryAt: "2026-01-01T00:00:03.000Z",
        attempt: 2,
        maxRetries: 5,
        errorMessage: "503 overloaded",
        failureCategory: "provider",
        httpStatus: 503,
      }),
      { nowMs },
    );
    assert.equal(model.badge, "run_retrying");
    assert.equal(model.tone, "info");
    assert.equal(model.busy, true);
    assert.equal(model.arg, "API error");
    assert.equal(model.summary, "503 overloaded");
    assert.deepEqual(
      model.chips?.map((chip) => chip.text),
      ["retry in 3s", "retry 2/5", "HTTP 503"],
    );
  });

  it("collapses an elapsed retry deadline to 'retrying now'", () => {
    const model = runStatusNoticeModel(
      notice({ state: "retrying", retryAt: "2025-12-31T23:59:59.000Z" }),
      { nowMs },
    );
    assert.equal(model.chips?.[0]?.text, "retrying now");
  });

  it("formats a provider payload and wires Continue as the primary action", () => {
    let continued = 0;
    const model = runStatusNoticeModel(
      notice({
        attempt: 3,
        errorMessage:
          '429 {"error":{"type":"rate_limit_error","message":"Try again later."}}',
      }),
      {
        nowMs,
        onContinue: () => {
          continued += 1;
        },
      },
    );
    assert.equal(model.tone, "destructive");
    assert.equal(model.badge, "run_failed");
    assert.equal(model.arg, "Rate limit");
    assert.equal(model.error, "Try again later.");
    assert.equal(model.action, undefined);
    assert.deepEqual(
      model.chips?.map((chip) => chip.text),
      ["retry 3", "HTTP 429"],
    );
    model.primaryAction?.onClick();
    assert.equal(continued, 1);
  });

  it("treats an interrupted run as destructive and only guides actionable recovery", () => {
    const staticModel = runStatusNoticeModel(
      notice({
        state: "interrupted",
        errorMessage: "Hook failed",
        failureCategory: "harness",
      }),
      { nowMs },
    );
    assert.equal(staticModel.tone, "destructive");
    assert.equal(staticModel.badge, "run_interrupted");
    assert.equal(staticModel.arg, "Harness error");
    assert.equal(staticModel.error, "Hook failed");
    assert.equal(staticModel.summary, undefined);
    assert.equal(staticModel.glyph, "bell-dot");
    assert.equal(staticModel.primaryAction, undefined);

    const actionableModel = runStatusNoticeModel(
      notice({ state: "interrupted" }),
      { nowMs, onContinue: () => undefined },
    );
    assert.match(actionableModel.summary ?? "", /Continue/);
    assert.equal(actionableModel.primaryAction?.label, "Continue");
  });
});
