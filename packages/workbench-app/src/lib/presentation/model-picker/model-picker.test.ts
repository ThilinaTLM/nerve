import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelInfo, ModelSelection } from "@nervekit/contracts/models";
import { buildModelCatalog } from "$lib/presentation/utils/model-catalog";
import {
  pickerListItems,
  pickerNavigableItems,
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
      query: "vision",
      entries,
      resolved: resolvePickerValue(entries, stale),
    });
    assert.deepEqual(
      items.map((item) => item.key),
      ["openai:gpt-old", "header:Anthropic", "anthropic:sonnet"],
    );
  });

  it("offers the parent's model first until the user searches", () => {
    const offered = pickerListItems({
      ...noFilter,
      entries,
      resolved: resolvePickerValue(entries, undefined),
      offerInherit: true,
    });
    assert.deepEqual(
      offered.map((item) => item.key),
      [
        "inherit",
        "header:Anthropic",
        "anthropic:sonnet",
        "header:OpenAI",
        "openai:gpt",
      ],
    );
    const searching = pickerListItems({
      ...noFilter,
      query: "gpt",
      entries,
      resolved: resolvePickerValue(entries, undefined),
      offerInherit: true,
    });
    assert.deepEqual(
      searching.map((item) => item.key),
      ["header:OpenAI", "openai:gpt"],
    );
  });

  it("matches provider names, capability aliases, ids, and AND terms", () => {
    const catalog = buildModelCatalog([
      model("openai", "first", { label: "Friendly", input: ["text", "image"] }),
      model("openai", "second", { contextWindow: 400_000 }),
      model("anthropic", "third", { supportedThinkingLevels: ["high"] }),
    ]);
    const matches = (query: string) =>
      pickerListItems({
        entries: catalog,
        query,
        resolved: { kind: "none" },
      })
        .filter((item) => item.kind === "model")
        .map((item) => item.key);
    assert.deepEqual(matches("openai"), ["openai:first", "openai:second"]);
    assert.deepEqual(matches("vision"), ["openai:first"]);
    assert.deepEqual(matches("image"), ["openai:first"]);
    assert.deepEqual(matches("thinking"), ["anthropic:third"]);
    assert.deepEqual(matches("reasoning"), ["anthropic:third"]);
    assert.deepEqual(matches("long context"), ["openai:second"]);
    assert.deepEqual(matches(" OpenAI   vision "), ["openai:first"]);
    assert.deepEqual(matches("anthropic vision"), []);
    assert.deepEqual(matches("first"), ["openai:first"]);
    assert.deepEqual(matches("friendly"), ["openai:first"]);
  });

  it("renders provider headers but excludes them from navigation", () => {
    const items = pickerListItems({
      entries,
      query: "",
      resolved: { kind: "none" },
    });
    assert.deepEqual(
      items.filter((item) => item.kind === "header").map((item) => item.label),
      ["Anthropic", "OpenAI"],
    );
    assert.deepEqual(
      pickerNavigableItems(items).map((item) => item.key),
      ["anthropic:sonnet", "openai:gpt"],
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
