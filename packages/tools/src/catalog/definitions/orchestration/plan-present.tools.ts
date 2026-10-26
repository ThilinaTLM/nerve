import { Type } from "typebox";
import type { ToolDefinition } from "../../contracts.js";

const planPresentParameters = Type.Object(
  {
    file_path: Type.String({
      description:
        "Absolute path to the finalized plan file inside plan storage.",
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
    description: `Submit a finalized plan file for user review.

Pass its absolute path as file_path.

Resolve material questions before submission. This tool ends your turn; approval switches the conversation to the configured approval profile for implementation. After rejection, wait for user direction and revise when requested.`,
    parameters: planPresentParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
