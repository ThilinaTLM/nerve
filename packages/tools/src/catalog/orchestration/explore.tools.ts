import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const exploreTaskParameters = Type.Object(
  {
    task: Type.String({
      description: "Specific independent codebase exploration task",
      minLength: 15,
    }),
    label: Type.Optional(
      Type.String({ description: "Short label for this exploration task" }),
    ),
    context: Type.Optional(
      Type.String({
        description:
          "Optional focused evidence or instructions specific to this task",
      }),
    ),
  },
  { additionalProperties: false },
);

const exploreParameters = Type.Object(
  {
    tasks: Type.Array(exploreTaskParameters, {
      minItems: 1,
      maxItems: 5,
      description:
        "One task launches one child. Two to five independent tasks launch in parallel and require split_rationale.",
    }),
    context: Type.String({
      minLength: 40,
      description:
        "Required. Summarize the parent agent's own quick grep/find/read lookup, what it found, and what remains unresolved. Mention relevant files or symbols when possible.",
    }),
    split_rationale: Type.Optional(
      Type.String({
        minLength: 40,
        description:
          "Required when tasks contains 2–5 items. Explain why the tasks are independent enough to split and why this is the right number of sub-agents.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const exploreToolDefinitions = [
  {
    name: "explore",
    group: "explore",
    baseRisk: "agent_spawn",
    traits: ["long_running"],
    executionKind: "host",
    label: "explore",
    description:
      "Delegate substantial read-only codebase investigations to child agents after your own quick lookup. Pass one required tasks array: one item launches one child; 2–5 independent items launch in parallel and require split_rationale. Each task may include focused context.",
    promptSnippet:
      "Delegate substantial, independent codebase investigations to read-only child agents after doing an initial lookup",
    promptGuidelines: [
      "Use explore only after a quick lookup, and only for substantial codebase investigations.",
      "Pass 1–5 items in tasks. For 2–5 independent tasks, explain the split in split_rationale.",
    ],
    parameters: exploreParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
