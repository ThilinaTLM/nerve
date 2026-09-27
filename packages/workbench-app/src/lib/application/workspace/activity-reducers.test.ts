import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { freshestActivity, mergeActivitySnapshots } from "./activity-freshness";

const earlier = { state: "running", updatedAt: "2026-01-01T00:00:00.000Z" };
const later = {
  state: "awaiting_async",
  updatedAt: "2026-01-01T00:00:01.000Z",
};

describe("activity snapshot freshness", () => {
  it("accepts a newer complete replacement", () => {
    assert.equal(freshestActivity(earlier, later), later);
  });

  it("keeps current state for stale or duplicate replacements", () => {
    assert.equal(freshestActivity(later, earlier), later);
    assert.equal(freshestActivity(later, { ...later, state: "idle" }), later);
  });

  it("hydrates a snapshot without undoing a newer event", () => {
    const merged = mergeActivitySnapshots(
      [earlier, { state: "idle", updatedAt: later.updatedAt, id: "other" }],
      { agent: later },
      (activity) => ("id" in activity ? activity.id : "agent"),
    );
    assert.equal(merged.agent, later);
    assert.equal(merged.other?.state, "idle");
  });
});
