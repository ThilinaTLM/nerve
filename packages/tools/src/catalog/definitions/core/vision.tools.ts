import { Type } from "typebox";
import { executeExplainImage } from "../../../execution/vision/explain-image.js";
import type { ToolDefinition } from "../../contracts.js";

const explainImageParameters = Type.Object(
  {
    path: Type.String({
      minLength: 1,
    }),
    prompt: Type.Optional(
      Type.String({
        description: "What to focus on.",
        minLength: 1,
      }),
    ),
  },
  { additionalProperties: false },
);

export const visionToolDefinitions = [
  {
    name: "explain_image",
    group: "vision",
    baseRisk: "network",
    traits: ["credentialed", "read_only_network"],
    executionKind: "local",
    executor: executeExplainImage,
    label: "Explain Image",
    description:
      "Describe an image in detail using the configured vision model; use when you can't view the image directly.",
    parameters: explainImageParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
