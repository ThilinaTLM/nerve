import { Type } from "typebox";
import type { ToolDefinition } from "../../contracts.js";

const planModePresentParameters = Type.Object(
  {
    file_path: Type.String({
      description: "Path to the markdown plan file inside Nerve plan storage",
    }),
  },
  { additionalProperties: false },
);

export const planModeToolDefinitions = [
  {
    name: "plan_mode_present",
    group: "planMode",
    baseRisk: "interaction",
    traits: ["suspending"],
    executionKind: "host",
    label: "plan_mode_present",
    description:
      "Present a written plan for user review and wait for acceptance, changes, or discard.",
    parameters: planModePresentParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
