import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelInfo, ModelSelection } from "$lib/api";
import {
  asyncSubagentModelOptions,
  asyncSubagentPatch,
  validAsyncSubagentPercent,
  leadModelOption,
} from "./async-subagent-options.js";

const available = [
  {
    provider: "anthropic",
    modelId: "claude-sonnet",
    name: "Sonnet",
  },
] as ModelInfo[];
const unavailable: ModelSelection = { provider: "openai", modelId: "gpt-old" };

describe("async teammate settings choices", () => {
  it("offers a lead fallback and preserves a saved unavailable model without offering it as a new selection", () => {
    const options = asyncSubagentModelOptions(available, unavailable);
    assert.equal(options[0].label, "Lead agent model");
    assert.deepEqual(options[1], {
      value: "openai:gpt-old",
      label: "openai/gpt-old (unavailable)",
      detail: "This configured model is no longer available.",
      disabled: true,
    });
    assert.equal(options[2].value, "anthropic:claude-sonnet");
    assert.deepEqual(
      asyncSubagentPatch(
        "openai:gpt-old",
        unavailable,
        available,
        "inherit",
        "80",
        "15",
      )?.asyncSubagent.model,
      unavailable,
    );
    assert.equal(
      asyncSubagentPatch(
        "openai:another",
        unavailable,
        available,
        "inherit",
        "80",
        "15",
      ),
      undefined,
    );
  });

  it("clears a model override atomically with profile and custom percentages", () => {
    assert.deepEqual(
      asyncSubagentPatch(
        leadModelOption,
        unavailable,
        available,
        "custom",
        "75",
        "20",
      ),
      {
        asyncSubagent: {
          model: null,
          compactionProfile: "custom",
          customTriggerPercent: 75,
          customKeepRecentPercent: 20,
        },
      },
    );
    assert.deepEqual(
      asyncSubagentPatch(
        "anthropic:claude-sonnet",
        undefined,
        available,
        "aggressive",
        "80",
        "15",
      )?.asyncSubagent.model,
      {
        provider: "anthropic",
        modelId: "claude-sonnet",
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
      asyncSubagentPatch(
        leadModelOption,
        undefined,
        available,
        "balanced",
        "80",
        "41",
      ),
      undefined,
    );
  });
});
