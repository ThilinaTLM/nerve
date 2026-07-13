import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const planModeEnterParameters = Type.Object(
  {
    reason: Type.Optional(
      Type.String({ description: "Why planning mode is needed" }),
    ),
  },
  { additionalProperties: false },
);

const planModePresentParameters = Type.Object(
  {
    file_path: Type.String({
      description: "Path to the markdown plan file inside Nerve plan storage",
    }),
    title: Type.Optional(
      Type.String({ description: "Optional display title" }),
    ),
    summary: Type.Optional(
      Type.String({ description: "Short summary for the review UI" }),
    ),
  },
  { additionalProperties: false },
);

const planModeForceExitParameters = Type.Object(
  {
    reason: Type.Optional(
      Type.String({
        description:
          "Why planning mode should be exited without an accepted plan",
      }),
    ),
  },
  { additionalProperties: false },
);

export const planModeToolDefinitions = [
  {
    name: "plan_mode_enter",
    group: "planMode",
    baseRisk: "interaction",
    traits: [],
    executionKind: "host",
    label: "plan_mode_enter",
    description:
      "Enter plan mode to research and prepare a reviewed plan before workspace edits.",
    promptSnippet: "Enter planning mode before preparing a reviewed plan",
    parameters: planModeEnterParameters,
    executionMode: "sequential",
  },
  {
    name: "plan_mode_present",
    group: "planMode",
    baseRisk: "interaction",
    traits: ["suspending"],
    executionKind: "host",
    label: "plan_mode_present",
    description:
      "Present a written plan for user review and wait for acceptance, changes, or discard.",
    promptSnippet: "Present a written plan and wait for user review",
    parameters: planModePresentParameters,
    executionMode: "sequential",
  },
  {
    name: "plan_mode_force_exit",
    group: "planMode",
    baseRisk: "interaction",
    traits: [],
    executionKind: "host",
    label: "plan_mode_force_exit",
    description: "Exit plan mode without an accepted plan, recording a reason.",
    promptSnippet: "Force exit planning mode with a reason",
    parameters: planModeForceExitParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
