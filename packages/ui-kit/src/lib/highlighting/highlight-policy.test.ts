import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWithinHighlightBudget,
  MAX_HIGHLIGHT_CODE_UNITS,
  MAX_HIGHLIGHT_LOGICAL_LINES,
} from "./highlight-policy";

describe("highlight budget", () => {
  it("includes the exact character boundary and rejects one unit over", () => {
    assert.equal(
      isWithinHighlightBudget("x".repeat(MAX_HIGHLIGHT_CODE_UNITS)),
      true,
    );
    assert.equal(
      isWithinHighlightBudget("x".repeat(MAX_HIGHLIGHT_CODE_UNITS + 1)),
      false,
    );
  });

  it("includes the exact line boundary and rejects one line over", () => {
    assert.equal(
      isWithinHighlightBudget("x\n".repeat(MAX_HIGHLIGHT_LOGICAL_LINES - 1)),
      true,
    );
    assert.equal(
      isWithinHighlightBudget("x\n".repeat(MAX_HIGHLIGHT_LOGICAL_LINES)),
      false,
    );
  });

  it("accepts empty code", () => {
    assert.equal(isWithinHighlightBudget(""), true);
  });
});
