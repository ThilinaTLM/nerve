import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldCommitVirtualMeasurement } from "./virtual-measurement";

describe("shouldCommitVirtualMeasurement", () => {
  it("commits initial and meaningful row heights", () => {
    assert.equal(shouldCommitVirtualMeasurement(undefined, 120), true);
    assert.equal(shouldCommitVirtualMeasurement(120, 121), true);
  });

  it("skips unchanged and sub-pixel-equivalent heights", () => {
    assert.equal(shouldCommitVirtualMeasurement(120, 120), false);
    assert.equal(shouldCommitVirtualMeasurement(120, 120.5), false);
  });

  it("commits a final animated height after intermediate geometry", () => {
    assert.equal(shouldCommitVirtualMeasurement(84, 180), true);
  });
});
