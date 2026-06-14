import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const exploreTaskParameters = Type.Object(
  {
    task: Type.String({ description: "Codebase exploration task" }),
    context: Type.Optional(
      Type.String({ description: "Useful context for this exploration" }),
    ),
    label: Type.Optional(
      Type.String({ description: "Short label for this exploration task" }),
    ),
  },
  { additionalProperties: false },
);

const exploreParameters = Type.Object(
  {
    task: Type.Optional(
      Type.String({ description: "Single codebase exploration task" }),
    ),
    context: Type.Optional(
      Type.String({ description: "Useful context for the single task" }),
    ),
    label: Type.Optional(
      Type.String({ description: "Short label for the single task" }),
    ),
    tasks: Type.Optional(
      Type.Array(exploreTaskParameters, {
        minItems: 1,
        description: "Multiple independent codebase exploration tasks",
      }),
    ),
  },
  { additionalProperties: false },
);

export const exploreToolDefinitions = [
  {
    name: "explore",
    label: "explore",
    description:
      "Run one or more read-only codebase exploration agents and return their reports.",
    promptSnippet:
      "Delegate substantial codebase exploration to read-only child agents",
    promptGuidelines: [
      "Use explore for substantial codebase investigations; batch independent questions with tasks when useful.",
      "Do not use explore for simple lookups that direct read/grep/find calls can answer quickly.",
    ],
    parameters: exploreParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
