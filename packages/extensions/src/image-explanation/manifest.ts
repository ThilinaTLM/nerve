import { defineExtension } from "@nervekit/extension-api";
import { explainImageTool, THINKING_LEVELS } from "./explain-image.js";

/** Image explanation: a vision model describes images to agents whose model cannot see them. */
export const imageExplanationExtension = defineExtension({
  id: "image-explanation",
  apiVersion: 1,
  name: "Image explanation",
  description: "Let text-only models understand images through a vision model.",
  icon: "eye",
  enabledByDefault: false,
  settings: {
    version: 1,
    fields: {
      model: {
        type: "model",
        capability: "vision",
        label: "Model",
        description: "The image-capable model that explains images.",
      },
      thinkingLevel: {
        type: "enum",
        label: "Thinking level",
        default: "off",
        options: THINKING_LEVELS.map((value) => ({ value, label: value })),
      },
    },
  },
  permissions: { capabilities: ["models.vision"] },
  namespaces: [],
  tools: [explainImageTool],
});
