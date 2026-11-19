import assert from "node:assert/strict";
import test from "node:test";
import { bridgeLimits } from "@nervekit/contracts/extensions";
import { FrameErrorGate } from "./frame-errors";

test("drops identical errors and caps the count until reset", () => {
  const gate = new FrameErrorGate();
  assert.equal(gate.accept({ kind: "error", message: "a" }), true);
  assert.equal(gate.accept({ kind: "error", message: "a" }), false);
  assert.equal(gate.accept({ kind: "csp", message: "a" }), true);
  for (let i = 0; i < bridgeLimits.maxFrameErrorsPerLoad; i += 1)
    gate.accept({ kind: "error", message: `m${i}` });
  assert.equal(gate.accept({ kind: "error", message: "late" }), false);
  gate.reset();
  assert.equal(gate.accept({ kind: "error", message: "a" }), true);
});
