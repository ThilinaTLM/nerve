import assert from "node:assert/strict";
import test from "node:test";
import {
  codeSpans,
  orderedReviewItems,
  reviewChangeLine,
  timeAgo,
} from "./review-format";

const now = Date.parse("2026-11-26T12:00:00Z");

test("broad items come first, then new ones, otherwise in the daemon's order", () => {
  const item = (text: string, broad = false, isNew = false) => ({
    text,
    short: text,
    broad,
    new: isNew,
  });
  assert.deepEqual(
    orderedReviewItems([
      item("plain"),
      item("new", false, true),
      item("broad", true),
      item("broad new", true, true),
    ]).map((entry) => entry.text),
    ["broad new", "broad", "new", "plain"],
  );
});

test("the change line says who changed it and when, only while it matters", () => {
  const changedAt = "2026-11-26T11:58:00Z";
  assert.equal(
    reviewChangeLine(
      { state: "needs_review", changedSinceDecision: true, changedAt },
      now,
    ),
    "Changed outside Nerve's settings · 2 min ago",
  );
  assert.equal(
    reviewChangeLine(
      { state: "needs_review", changedSinceDecision: false },
      now,
    ),
    "Added outside Nerve's settings",
  );
  assert.equal(
    reviewChangeLine({ state: "trusted", changedSinceDecision: false }, now),
    undefined,
  );
  assert.equal(timeAgo("2026-11-26T11:59:50Z", now), "just now");
  assert.equal(timeAgo("2026-11-26T09:00:00Z", now), "3 h ago");
});

test("daemon sentences render code spans, never HTML", () => {
  assert.deepEqual(codeSpans("Runs `pnpm test` and <b>x</b>"), [
    { text: "Runs ", code: false },
    { text: "pnpm test", code: true },
    { text: " and <b>x</b>", code: false },
  ]);
  assert.deepEqual(codeSpans("a ` b"), [{ text: "a ` b", code: false }]);
});
