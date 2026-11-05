import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  argumentLifecycleStage,
  mergeMetaItems,
  toolCallTiming,
  toolSizeArgument,
} from "./tool-call-model";

describe("tool call model", () => {
  it("maps call status to the argument lifecycle stage", () => {
    assert.equal(argumentLifecycleStage(undefined), "drafting");
    assert.equal(argumentLifecycleStage({ status: "denied" }), "failed");
    assert.equal(argumentLifecycleStage({ status: "completed" }), "completed");
    assert.equal(argumentLifecycleStage({ status: "waiting" }), "executing");
  });

  it("keeps the first meta item per key and derives keys from text", () => {
    const merged = mergeMetaItems(
      [{ key: "a", text: "first" }],
      [{ key: "a", text: "dup" }, { text: "12 lines" }, { text: "34 lines" }],
    );
    assert.deepEqual(
      merged.map((item) => item.text),
      ["first", "12 lines"],
    );
  });

  it("starts the clock at updatedAt only while running", () => {
    const updatedAt = "2026-01-01T00:00:10.000Z";
    assert.equal(
      toolCallTiming({ status: "running", updatedAt })?.startedAtMs,
      Date.parse(updatedAt),
    );
    assert.equal(
      toolCallTiming({ status: "waiting", updatedAt }).startedAtMs,
      undefined,
    );
    assert.equal(toolCallTiming(undefined).settledAtMs, undefined);
  });

  it("reads a string size argument only", () => {
    assert.equal(toolSizeArgument({ size: "1024x1024" }), "1024x1024");
    assert.equal(toolSizeArgument({ size: 3 }), undefined);
    assert.equal(toolSizeArgument(undefined), undefined);
  });
});
