import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateSetupProgress } from "./setup-progress.js";

describe("setup progress", () => {
  it("counts the five independent setup areas", () => {
    assert.deepEqual(
      calculateSetupProgress({
        providerReady: true,
        voiceReady: false,
        scopedModelsValid: true,
        agentDefaultsReady: true,
        productTourCompleted: false,
      }),
      { ready: 3, total: 5 },
    );
  });

  it("treats an empty scoped-model selection as valid via its readiness input", () => {
    assert.equal(
      calculateSetupProgress({
        providerReady: false,
        voiceReady: false,
        scopedModelsValid: true,
        agentDefaultsReady: false,
        productTourCompleted: false,
      }).ready,
      1,
    );
  });
});
