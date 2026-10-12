import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runStatusNoticeModel } from "./run-status-notice";

describe("retrying run notices", () => {
  it("surfaces the failure while accurately describing the pending retry", () => {
    const model = runStatusNoticeModel({
      state: "retrying",
      errorMessage: "Connection lost",
      failureCategory: "connection",
      attempt: 2,
      maxRetries: 5,
      httpStatus: 503,
    });
    assert.equal(model.badge, "run_retrying");
    assert.equal(model.tone, "destructive");
    assert.equal(model.glyph, "bell-dot");
    assert.equal(model.busy, false);
    assert.equal(model.arg, "Connection error");
    assert.equal(model.statusLabel, "Model request failed; waiting to retry");
    assert.equal(model.error, "Connection lost");
    assert.equal(model.summary, undefined);
    assert.deepEqual(model.chips, [
      { text: "UI-only", tone: "neutral" },
      { text: "retry 2/5" },
      { text: "HTTP 503", mono: true },
    ]);
  });

  it("retains an error treatment without inventing missing failure text", () => {
    const model = runStatusNoticeModel({ state: "retrying" });
    assert.equal(model.tone, "destructive");
    assert.equal(model.glyph, "bell-dot");
    assert.equal(model.arg, "Run error");
    assert.equal(model.error, undefined);
    assert.equal(model.summary, undefined);
  });

  it("does not offer manual continuation during automatic backoff", () => {
    const model = runStatusNoticeModel(
      { state: "retrying", errorMessage: "Connection lost" },
      { onContinue: () => assert.fail("Retry must remain automatic") },
    );
    assert.equal(model.primaryAction, undefined);
  });
});
