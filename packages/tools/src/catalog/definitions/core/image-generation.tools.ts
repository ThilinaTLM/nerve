import { Type } from "typebox";
import { executeGenerateImage } from "../../../execution/image-generation/generate-image.js";
import type { ToolDefinition } from "../../contracts.js";

const generateImageParameters = Type.Object(
  {
    prompt: Type.String({
      minLength: 1,
      maxLength: 32_000,
    }),
  },
  { additionalProperties: false },
);

export const imageGenerationToolDefinitions = [
  {
    name: "generate_image",
    group: "imageGeneration",
    baseRisk: "network",
    traits: ["credentialed"],
    executionKind: "local",
    executor: executeGenerateImage,
    label: "Generate Image",
    description: "Generate an image from a text prompt.",
    parameters: generateImageParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
