import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planReviewContent, planReviewPreview } from "./plan-mode-preview";

describe("plan mode preview", () => {
  it("prefers the hydrated full plan over the bounded transcript result", () => {
    const bounded = "line 1\nline 2";
    const full = "line 1\nline 2\nline 3\nline 4";
    assert.equal(planReviewContent(bounded, full), full);
    assert.equal(planReviewContent(bounded, undefined), bounded);
  });

  it("uses leading lines when collapsed and all content when expanded", () => {
    const content = "line 1\nline 2\nline 3\nline 4";
    assert.equal(planReviewPreview(content, false, 2), "line 1\nline 2");
    assert.equal(planReviewPreview(content, true, 2), content);
  });
});
