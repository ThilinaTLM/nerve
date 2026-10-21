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
      "Assign work to agents from `<available_agent_profiles>`. A new name creates one; an existing name queues a follow-up. Sub-agents share your worktree, can't see this conversation, and run asynchronously; completion notices wake you, so continue or end your turn. Batch parallel work in one call with non-overlapping scopes, put shared background in `context`, and give each one the paths, constraints, and expected outcome.",
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
      "Inspect sub-agents: without a name, one line each; with a name, its final response or recent activity. Use only for long or suspicious work; notices already wake you.",
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
      "Stop sub-agents' current execution; they can be prompted again.",
    parameters: Type.Object(
      { names: Type.Array(name, { minItems: 1 }) },
      { additionalProperties: false },
    ),
  },
] satisfies ToolDefinition[];
