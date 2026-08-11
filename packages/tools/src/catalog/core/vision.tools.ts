import { Type } from "typebox";
import { executeExplainImage } from "../../execution/vision/explain-image.js";
import type { ToolDefinition } from "../types.js";

const explainImageParameters = Type.Object(
  {
    path: Type.String({
      description: "Absolute or project-relative path to an image file",
      minLength: 1,
    }),
    prompt: Type.Optional(
      Type.String({
        description:
          "Optional question or specific detail the vision model should focus on",
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
      "Ask the vision model configured in Nerve Settings to explain an image as detailed text.",
    promptSnippet:
      "Explain an image path with the configured vision model when you cannot inspect images directly",
    promptGuidelines: [
      "Use explain_image for image paths you need to understand. Include a focused prompt when the user asks about a specific visual detail.",
    ],
    parameters: explainImageParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
