import { defineExtension } from "@nervekit/extension-api";
import { explainImageTool } from "./explain-image.js";

/**
 * Settings v1 → v2: `thinkingLevel` becomes `model.reasoningLevel`. An entry that sets a level
 * without a model has nothing to attach it to, so the level is dropped.
 */
function foldThinkingLevel(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const { thinkingLevel, ...rest } = settings;
  const model = rest.model;
  if (
    typeof thinkingLevel === "string" &&
    model !== null &&
    typeof model === "object" &&
    !Array.isArray(model)
  )
    return { ...rest, model: { ...model, reasoningLevel: thinkingLevel } };
  return rest;
}

/** Image explanation: a vision model describes images to agents whose model cannot see them. */
export const imageExplanationExtension = defineExtension({
  id: "image-explanation",
  name: "Image explanation",
  description: "Let text-only models understand images through a vision model.",
  icon: "eye",
  enabledByDefault: false,
  settings: {
    version: 2,
    fields: {
      model: {
        type: "model",
        capability: "vision",
        reasoning: true,
        label: "Model",
        description: "The image-capable model that explains images.",
      },
    },
    // Version 1 kept the reasoning level in its own `thinkingLevel` field.
    migrations: { 2: foldThinkingLevel },
  },
  permissions: { models: ["vision"] },
  namespaces: [],
  tools: [explainImageTool],
});
