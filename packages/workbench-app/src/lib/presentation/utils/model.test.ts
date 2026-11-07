import assert from "node:assert/strict";
import test from "node:test";
import { modelInfoSchema } from "@nervekit/contracts/models";
import { scopedUsableModelOptions } from "./model";

const info = (provider: string, modelId: string, faux?: boolean) =>
  modelInfoSchema.parse({
    provider,
    modelId,
    name: modelId,
    label: modelId,
    faux,
  });

test("scoped model lists keep keyless faux models", () => {
  const models = [
    info("anthropic", "a"),
    info("anthropic", "b"),
    info("nerve-dev-scripted", "scripted-bench", true),
  ];
  const providers = [{ provider: "anthropic", configured: true }] as never;
  const result = scopedUsableModelOptions(models, providers, [
    { provider: "anthropic", modelId: "a" },
  ]);
  assert.deepEqual(
    result.map((model) => model.modelId),
    ["a", "scripted-bench"],
  );
});
