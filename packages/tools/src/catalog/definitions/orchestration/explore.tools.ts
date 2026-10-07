import { Type } from "typebox";
import { EXPLORE_MAX_TASKS_PER_CALL } from "@nervekit/contracts/agents";
import type { ToolDefinition } from "../../contracts.js";

const exploreTaskParameters = Type.Object(
  {
    task: Type.String({
      minLength: 15,
    }),
    label: Type.String({
      minLength: 3,
      maxLength: 40,
    }),
    context: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const exploreParameters = Type.Object(
  {
    tasks: Type.Array(exploreTaskParameters, {
      minItems: 1,
      maxItems: EXPLORE_MAX_TASKS_PER_CALL,
    }),
    context: Type.String({
      minLength: 40,
    }),
    split_rationale: Type.Optional(
      Type.String({
        minLength: 40,
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
    description: `Delegate substantial read-only research after your initial lookup. Required context summarizes that grep/find/read evidence and unresolved questions, with files/symbols. Each task launches a fresh isolated child; label is a 2–5 word noun phrase (e.g. Settings schema defaults), not a verb. Per-task context adds focused evidence/instructions. For 2–${EXPLORE_MAX_TASKS_PER_CALL} independent tasks, provide split_rationale explaining independence and count; shared concurrency limits apply. Waits for exactly the submitted runs and returns reports; children remain steerable/configurable under immutable read-only authority.`,
    parameters: exploreParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
