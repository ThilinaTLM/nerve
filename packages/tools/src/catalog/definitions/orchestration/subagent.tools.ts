import { Type } from "typebox";
import { SUBAGENT_BATCH_LIMIT } from "@nervekit/contracts/subagents";
import type { ToolDefinition } from "../../contracts.js";

const name = Type.String({ minLength: 1, maxLength: 80 });

export const subagentToolDefinitions = [
  {
    name: "subagent_prompt",
    group: "subagents",
    baseRisk: "agent_spawn",
    traits: ["write_capable"],
    executionKind: "host",
    label: "subagent_prompt",
    description:
      "Assign work to sub-agents. A new name creates one from `profile`; an existing name queues a follow-up. Sub-agents run asynchronously in your worktree and cannot see your conversation; completion notices wake you.",
    parameters: Type.Object(
      {
        context: Type.Optional(Type.String()),
        assignments: Type.Array(
          Type.Object(
            {
              name,
              profile: Type.Optional(Type.String()),
              prompt: Type.String({ minLength: 1 }),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: SUBAGENT_BATCH_LIMIT },
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "subagent_status",
    group: "subagents",
    baseRisk: "read",
    traits: [],
    executionKind: "host",
    label: "subagent_status",
    description:
      "Check sub-agents. Without a name, one line each; with a name, its final response or recent activity. Not needed after assigning: notices wake you.",
    parameters: Type.Object(
      { name: Type.Optional(name) },
      { additionalProperties: false },
    ),
  },
  {
    name: "subagent_stop",
    group: "subagents",
    baseRisk: "agent_spawn",
    traits: [],
    executionKind: "host",
    label: "subagent_stop",
    description:
      "Stop the current execution of sub-agents. They remain and can be prompted again.",
    parameters: Type.Object(
      { names: Type.Array(name, { minItems: 1 }) },
      { additionalProperties: false },
    ),
  },
] satisfies ToolDefinition[];
