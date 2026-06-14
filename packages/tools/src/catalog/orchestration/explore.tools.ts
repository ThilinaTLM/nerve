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
    label: "explore",
    description: [
      "Spawn read-only child agents to investigate the codebase and return concise reports.",
      "Single mode: { task, context, label? }.",
      "Parallel mode: { tasks: [{ task, label? }, ...], context, split_rationale } with 2-5 independent tasks.",
      "Before using this tool, do your own quick grep/find/read lookup to size the problem.",
      "Use explore only when the remaining work requires reading many files, tracing dependencies, or understanding a subsystem.",
      "Always pass context summarizing what you already checked, what you found, and what remains unclear.",
      "In parallel mode, use the fewest agents necessary and split only into truly independent investigations.",
      "Do not use explore for simple lookups you can answer directly with a few read/grep/find calls.",
    ].join(" "),
    promptSnippet:
      "Delegate substantial, independent codebase investigations to read-only child agents after doing an initial lookup",
    promptGuidelines: [
      "Before using explore, do your own quick grep/find/read lookup to size the problem and identify likely files or symbols.",
      "Use explore only when the remaining work requires reading many files, tracing dependencies, or understanding a subsystem.",
      "Always pass context summarizing what you already checked, what you found, and what remains unclear.",
      "Use single-task explore for one substantial investigation.",
      "Use tasks only for 2-5 truly independent investigations; include split_rationale explaining the split and why that agent count is appropriate.",
      "Use the fewest explore agents necessary.",
      "Do not use explore for simple lookups you can answer directly with a few read/grep/find calls.",
    ],
    parameters: exploreParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
