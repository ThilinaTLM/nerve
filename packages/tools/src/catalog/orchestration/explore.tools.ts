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
  },
  { additionalProperties: false },
);

const exploreParameters = Type.Object(
  {
    task: Type.Optional(
      Type.String({
        description: "Specific codebase exploration task for single-agent mode",
        minLength: 15,
      }),
    ),
    tasks: Type.Optional(
      Type.Array(exploreTaskParameters, {
        minItems: 2,
        maxItems: 5,
        description: "Independent exploration tasks for parallel execution",
      }),
    ),
    context: Type.String({
      minLength: 40,
      description:
        "Required. Summarize the parent agent's own quick grep/find/read lookup, what it found, and what remains unresolved. Mention relevant files or symbols when possible.",
    }),
    label: Type.Optional(
      Type.String({ description: "Short label for the single task" }),
    ),
    split_rationale: Type.Optional(
      Type.String({
        minLength: 40,
        description:
          "Required when using tasks. Explain why the tasks are independent enough to split and why this is the right number of sub-agents.",
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
      "Delegate substantial read-only codebase investigations to child agents after your own quick lookup. Use single { task, context, label? } or parallel { tasks, context, split_rationale } for 2-5 independent tasks.",
    promptSnippet:
      "Delegate substantial, independent codebase investigations to read-only child agents after doing an initial lookup",
    promptGuidelines: [
      "Use explore only after a quick lookup, and only for substantial codebase investigations.",
    ],
    parameters: exploreParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
