import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelInfo } from "@nervekit/contracts/models";
import { implementationModelCompatible } from "./profile-choice-constraints";
const model: ModelInfo = {
  provider: "test",
  modelId: "one",
  name: "One",
  label: "One",
  reasoning: true,
  input: ["text"],
  supportedThinkingLevels: ["low", "high"],
  contextWindow: 1000,
  maxOutputTokens: 100,
};
test("plan choices must satisfy both atomic model requirements and supported required reasoning", () => {
  assert.equal(
    implementationModelCompatible(model, {
      model: { provider: "test", modelId: "one" },
      reasoningLevel: "high",
    }),
    true,
  );
  assert.equal(
    implementationModelCompatible(model, {
      model: { provider: "other", modelId: "one" },
    }),
    false,
  );
  assert.equal(
    implementationModelCompatible(model, { reasoningLevel: "max" }),
    false,
  );
  assert.equal(implementationModelCompatible(model, {}), true);
});
