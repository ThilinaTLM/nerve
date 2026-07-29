import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseExploreRequest } from "../src/runtime/orchestration/args.js";

function tasks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    task: `Investigate independent subsystem number ${index + 1}`,
  }));
}

describe("Explore argument validation", () => {
  it("accepts eight tasks in one call", () => {
    const request = parseExploreRequest({
      tasks: tasks(8),
      context: "The parent completed an initial source lookup for this work.",
      split_rationale:
        "Each subsystem is independent and all eight investigations are needed.",
    });

    assert.equal(request.tasks.length, 8);
  });

  it("gives actionable guidance when one call contains too many tasks", () => {
    assert.throws(
      () =>
        parseExploreRequest({
          tasks: tasks(9),
          context:
            "The parent completed an initial source lookup for this work.",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /received 9 tasks/);
        assert.match(error.message, /at most 8/);
        assert.match(error.message, /Split independent work/);
        assert.match(error.message, /24 child launches/);
        return true;
      },
    );
  });
});
