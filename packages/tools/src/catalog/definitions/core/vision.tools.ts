import { Type } from "typebox";
import { executeExplainImage } from "../../../execution/vision/explain-image.js";
import { executeGptImage } from "../../../execution/vision/gpt-image.js";
import type { ToolDefinition } from "../../contracts.js";

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

const gptImageParameters = Type.Object(
  {
    prompt: Type.String({
      description: "Describe the image to generate",
      minLength: 1,
      maxLength: 32_000,
    }),
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
    parameters: explainImageParameters,
    executionMode: "sequential",
  },
  {
    name: "gpt_image",
    group: "vision",
    baseRisk: "network",
    traits: ["credentialed"],
    executionKind: "local",
    executor: executeGptImage,
    label: "GPT Image",
    description:
      "Generate an image from a text prompt using the GPT Image model and output settings configured by the user.",
    parameters: gptImageParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
