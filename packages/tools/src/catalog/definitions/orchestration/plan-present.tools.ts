import { Type } from "typebox";
import type { ToolDefinition } from "../../contracts.js";

const planPresentParameters = Type.Object(
  {
    file_path: Type.String({
      description: "Inside plan storage.",
    }),
  },
  { additionalProperties: false },
);

export const planPresentToolDefinitions = [
  {
    name: "plan_present",
    group: "planMode",
    baseRisk: "interaction",
    traits: ["suspending"],
    executionKind: "host",
    label: "plan_present",
    description:
      "Submit a plan file from plan storage for user review. Ends your turn; approval switches the conversation to the default profile for implementation.",
    parameters: planPresentParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
