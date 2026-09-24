import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelInfo, ModelSelection } from "$lib/api";
import { buildModelCatalog } from "$lib/presentation/utils/model-catalog";
import {
  pickerListItems,
  resolvePickerValue,
  scopedCatalogRows,
  toggleScopedModel,
} from "./model-picker.js";

function model(
  provider: string,
  modelId: string,
  overrides: Partial<ModelInfo> = {},
): ModelInfo {
  return {
    provider,
    modelId,
    name: modelId,
    label: modelId,
    reasoning: false,
    input: ["text"],
    supportedThinkingLevels: ["off"],
    contextWindow: 0,
    maxOutputTokens: 0,
    ...overrides,
  };
}

const entries = buildModelCatalog([
  model("anthropic", "sonnet", { input: ["text", "image"] }),
  model("openai", "gpt", { supportedThinkingLevels: ["low", "high"] }),
]);
const stale: ModelSelection = { provider: "openai", modelId: "gpt-old" };
const noFilter = { query: "", provider: "all", capabilities: new Set<never>() };

describe("settings model picker", () => {
  it("resolves available, unavailable, and empty values", () => {
    assert.equal(resolvePickerValue(entries, undefined).kind, "none");
    assert.equal(
      resolvePickerValue(entries, { provider: "openai", modelId: "gpt" }).kind,
      "available",
    );
    assert.deepEqual(resolvePickerValue(entries, stale), {
      kind: "unavailable",
      selection: stale,
    });
  });

  it("pins an unavailable selection above the filtered catalog", () => {
    const items = pickerListItems({
      ...noFilter,
      capabilities: new Set(["vision"] as const),
      entries,
      resolved: resolvePickerValue(entries, stale),
    });
    assert.deepEqual(
      items.map((item) => item.key),
      ["openai:gpt-old", "anthropic:sonnet"],
    );
  });

  it("lists stale scoped models first in the scoped view and only available models in the all view", () => {
    const scoped = [{ provider: "openai", modelId: "gpt" }, stale];
    const scopedRows = scopedCatalogRows({
      ...noFilter,
      entries,
      scoped,
      view: "scoped",
    });
    assert.deepEqual(
      scopedRows.map((row) => [row.key, row.checked, row.stale]),
      [
        ["openai:gpt-old", true, true],
        ["openai:gpt", true, false],
      ],
    );
    const allRows = scopedCatalogRows({
      ...noFilter,
      entries,
      scoped,
      view: "all",
    });
    assert.deepEqual(
      allRows.map((row) => [row.key, row.checked]),
      [
        ["anthropic:sonnet", false],
        ["openai:gpt", true],
      ],
    );
    assert.deepEqual(
      scopedCatalogRows({
        ...noFilter,
        capabilities: new Set(["reasoning"] as const),
        entries,
        scoped,
        view: "scoped",
      }).map((row) => row.key),
      ["openai:gpt"],
    );
  });

  it("toggles scope idempotently while preserving order and stale entries", () => {
    const sonnet = { provider: "anthropic", modelId: "sonnet" };
    const added = toggleScopedModel([stale], sonnet, true);
    assert.deepEqual(added, [stale, sonnet]);
    assert.equal(toggleScopedModel(added, sonnet, true), added);
    assert.deepEqual(toggleScopedModel(added, sonnet, false), [stale]);
    assert.equal(toggleScopedModel([stale], sonnet, false).length, 1);
    assert.deepEqual(toggleScopedModel(added, stale, false), [sonnet]);
  });
});
