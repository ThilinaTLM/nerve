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
    label: "plan_mode_enter",
    description:
      "Enter planning mode for research and plan preparation before workspace edits. No-op if already in planning mode.",
    promptSnippet: "Enter planning mode before preparing a reviewed plan",
    promptGuidelines: [
      "Use plan_mode_enter from coding mode when the user asks for a plan or when the task needs research before edits.",
    ],
    parameters: planModeEnterParameters,
    executionMode: "sequential",
  },
  {
    name: "plan_mode_present",
    label: "plan_mode_present",
    description:
      "Present a written plan to the user for review and wait for acceptance, change requests, or discard.",
    promptSnippet: "Present a written plan and wait for user review",
    promptGuidelines: [
      "Call plan_mode_present with the plan file path after writing the plan with write/edit and resolving every open question.",
      "Do not implement workspace changes until the plan is accepted.",
    ],
    parameters: planModePresentParameters,
    executionMode: "sequential",
  },
  {
    name: "plan_mode_force_exit",
    label: "plan_mode_force_exit",
    description:
      "Exit planning mode without an accepted plan, recording an explicit reason.",
    promptSnippet: "Force exit planning mode with a reason",
    promptGuidelines: [
      "Use plan_mode_force_exit only when planning should end without an accepted plan.",
    ],
    parameters: planModeForceExitParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
