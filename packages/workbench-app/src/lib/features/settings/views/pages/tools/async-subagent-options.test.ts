import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelSelection } from "$lib/api";
import {
  asyncSubagentPatch,
  validAsyncSubagentPercent,
} from "./async-subagent-options.js";

const unavailable: ModelSelection = { provider: "openai", modelId: "gpt-old" };

describe("async teammate settings choices", () => {
  it("keeps a chosen model and thinking level, including a retained unavailable model", () => {
    assert.deepEqual(
      asyncSubagentPatch(unavailable, "high", "inherit", "80", "15")
        ?.asyncSubagent,
      {
        model: unavailable,
        thinkingLevel: "high",
        compactionProfile: "inherit",
        customTriggerPercent: 80,
        customKeepRecentPercent: 15,
      },
    );
  });

  it("clears a model override and its thinking level atomically with profile and custom percentages", () => {
    assert.deepEqual(
      asyncSubagentPatch(undefined, "high", "custom", "75", "20"),
      {
        asyncSubagent: {
          model: null,
          thinkingLevel: null,
          compactionProfile: "custom",
          customTriggerPercent: 75,
          customKeepRecentPercent: 20,
        },
      },
    );
  });

  it("rejects empty, fractional, and out-of-range custom percentages", () => {
    for (const value of ["", "59", "90.5", "91", "NaN"]) {
      assert.equal(validAsyncSubagentPercent(value, 60, 90), false);
    }
    assert.equal(validAsyncSubagentPercent("60", 60, 90), true);
    assert.equal(validAsyncSubagentPercent("40", 5, 40), true);
    assert.equal(
      asyncSubagentPatch(undefined, "off", "balanced", "80", "41"),
      undefined,
    );
  });
});
