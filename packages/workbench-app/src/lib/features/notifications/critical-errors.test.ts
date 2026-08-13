import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CriticalErrorQueue, errorDetails } from "./critical-error-queue";

describe("critical error queue", () => {
  it("keeps the active error until it is acknowledged", () => {
    const errors = new CriticalErrorQueue();
    errors.show("First failed", "first details");
    errors.show("Second failed", "second details");

    assert.equal(errors.current?.title, "First failed");
    assert.equal(errors.queue.length, 1);

    errors.acknowledge();
    assert.equal(errors.current?.title, "Second failed");
    errors.acknowledge();
    assert.equal(errors.current, undefined);
  });

  it("coalesces errors for the same explicit action", () => {
    const errors = new CriticalErrorQueue();
    errors.show("Failed", "first details");
    errors.show("Failed", "second details");
    errors.show("Failed", "first details");
    errors.show("Other", "other details");
    errors.show("Other", "more details");

    assert.equal(errors.current?.title, "Failed");
    assert.equal(errors.current?.details, "first details\n\nsecond details");
    assert.deepEqual(
      errors.queue.map((request) => request.title),
      ["Other"],
    );
    assert.equal(errors.queue[0]?.details, "other details\n\nmore details");
  });

  it("normalizes empty and unknown error details", () => {
    assert.equal(
      errorDetails(new Error("network unavailable")),
      "network unavailable",
    );
    assert.equal(errorDetails(""), "An unknown error occurred.");
  });
});
