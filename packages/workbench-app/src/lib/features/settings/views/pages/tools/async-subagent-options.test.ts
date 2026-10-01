import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelSelection } from "$lib/api";
import {
  asyncSubagentSettingsFromDraft,
  asyncSubagentSettingsPatch,
  validAsyncSubagentPercent,
} from "./async-subagent-options.js";

const unavailable: ModelSelection = { provider: "openai", modelId: "gpt-old" };

describe("async teammate settings choices", () => {
  it("keeps a chosen model and thinking level, including a retained unavailable model", () => {
    assert.deepEqual(
      asyncSubagentSettingsFromDraft(
        unavailable,
        "high",
        "inherit",
        "80",
        "15",
      ),
      {
        model: unavailable,
        thinkingLevel: "high",
        compactionProfile: "inherit",
        customTriggerPercent: 80,
        customKeepRecentPercent: 15,
      },
    );
  });

  it("drops the thinking level with the model so teammates follow the lead", () => {
    const settings = asyncSubagentSettingsFromDraft(
      undefined,
      "high",
      "custom",
      "75",
      "20",
    );
    assert.deepEqual(settings, {
      compactionProfile: "custom",
      customTriggerPercent: 75,
      customKeepRecentPercent: 20,
    });
    assert.deepEqual(settings && asyncSubagentSettingsPatch(settings), {
      asyncSubagent: {
        model: null,
        thinkingLevel: null,
        compactionProfile: "custom",
        customTriggerPercent: 75,
        customKeepRecentPercent: 20,
      },
    });
  });

  it("rejects empty, fractional, and out-of-range custom percentages", () => {
    for (const value of ["", "59", "90.5", "91", "NaN"]) {
      assert.equal(validAsyncSubagentPercent(value, 60, 90), false);
    }
    assert.equal(validAsyncSubagentPercent("60", 60, 90), true);
    assert.equal(validAsyncSubagentPercent("40", 5, 40), true);
    assert.equal(
      asyncSubagentSettingsFromDraft(undefined, "off", "balanced", "80", "41"),
      undefined,
    );
  });
});
