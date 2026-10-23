import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import { modelInfoSchema } from "@nervekit/contracts/models";
import { resolveNewAgentComposerSelection } from "./agent-selection.js";

void test("new conversations use configured model, reasoning and permission defaults", () => {
  const settings = {
    ...structuredClone(defaultSettings),
    defaultModel: { provider: "test", modelId: "configured" },
    defaultThinkingLevel: "high" as const,
    defaultPermissionRuleSetId: "planning",
  };
  const models = ["other", "configured"].map((modelId) =>
    modelInfoSchema.parse({
      provider: "test",
      modelId,
      name: modelId,
      label: modelId,
      supportedThinkingLevels: ["off", "low", "high"],
    }),
  );
  const result = resolveNewAgentComposerSelection(settings, models, [
    {
      provider: "test",
      displayName: "Test",
      configured: true,
      supportsApiKey: true,
      supportsOAuth: false,
    },
  ]);
  assert.deepEqual(result, {
    selectedModelKey: "test:configured",
    selectedThinkingLevel: "high",
    selectedPermissionRuleSetId: "planning",
  });
  assert.deepEqual(settings.defaultModel, {
    provider: "test",
    modelId: "configured",
  });
});
