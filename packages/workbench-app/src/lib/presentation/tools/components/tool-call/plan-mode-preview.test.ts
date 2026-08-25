import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planReviewContent, planReviewPreview } from "./plan-mode-preview";

describe("plan mode preview", () => {
  it("uses the best available plan content", () => {
    const summary = "line 1\nline 2";
    const bounded = "line 1\nline 2\nline 3";
    const full = "line 1\nline 2\nline 3\nline 4";

    assert.equal(planReviewContent(bounded, full, summary), full);
    assert.equal(planReviewContent(bounded, undefined, summary), bounded);
    assert.equal(planReviewContent(undefined, undefined, summary), summary);
    assert.equal(planReviewContent(undefined, undefined), "");
  });

  it("uses leading lines when collapsed and all content when expanded", () => {
    const content = "line 1\nline 2\nline 3\nline 4";
    assert.equal(planReviewPreview(content, false, 2), "line 1\nline 2");
    assert.equal(planReviewPreview(content, true, 2), content);
  });
});
