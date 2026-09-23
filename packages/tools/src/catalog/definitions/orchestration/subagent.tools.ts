import { Type } from "typebox";
import type { ToolDefinition } from "../../contracts.js";

const id = Type.String({
  minLength: 1,
  description: "Stable ID of a teammate owned by this lead.",
});
export const subagentToolDefinitions = [
  {
    name: "subagent_new",
    group: "subagents",
    baseRisk: "agent_spawn",
    traits: ["write_capable"],
    executionKind: "host",
    label: "subagent_new",
    description:
      "Create an idle autonomous developer teammate sharing your working directory. Assign non-overlapping component ownership; its conversation persists for follow-ups.",
    parameters: Type.Object(
      { name: Type.String({ minLength: 1, maxLength: 80 }) },
      { additionalProperties: false },
    ),
  },
  {
    name: "subagent_prompt",
    group: "subagents",
    baseRisk: "agent_spawn",
    traits: ["write_capable"],
    executionKind: "host",
    label: "subagent_prompt",
    description:
      "Start an idle teammate asynchronously. Rejects running/stopping teammates without queueing. Completion notifies and wakes you; continue independent work or finish your turn.",
    parameters: Type.Object(
      { id, prompt: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
  },
  {
    name: "subagent_list",
    group: "subagents",
    baseRisk: "read",
    traits: [],
    executionKind: "host",
    label: "subagent_list",
    description:
      "List your persistent teammates and their lifecycle states, without response bodies.",
    parameters: Type.Object(
      {
        cursor: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
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
      "Inspect a teammate's state. Only idle teammates expose their last assistant response, attributed to its run. Running teammates expose no partial response.",
    parameters: Type.Object({ id }, { additionalProperties: false }),
  },
  {
    name: "subagent_stop",
    group: "subagents",
    baseRisk: "workspace_write",
    traits: ["write_capable"],
    executionKind: "host",
    label: "subagent_stop",
    description:
      "Cancel a teammate's execution and owned background work without deleting its history. Wait for idle before sending a replacement assignment.",
    parameters: Type.Object({ id }, { additionalProperties: false }),
  },
] satisfies ToolDefinition[];
