import { Type } from "typebox";
import type { ToolDefinition } from "../../contracts.js";

const teammateName = Type.String({
  minLength: 1,
  maxLength: 80,
  description: "Name of a teammate owned by this lead (case-insensitive).",
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
      "Create an idle autonomous developer teammate with a unique name within your team.",
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
      "Start an assignment only with an idle teammate. Prompts for running or stopping teammates are rejected, never queued. The teammate cannot see your conversation history or discoveries unless you include them in the prompt. Provide relevant findings, file paths, constraints, and the expected outcome. It can inspect the shared worktree and retains its own context from earlier assignments.",
    parameters: Type.Object(
      { name: teammateName, prompt: Type.String({ minLength: 1 }) },
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
      "Inspect a teammate's state and, when idle, its last response and run identity.",
    parameters: Type.Object(
      { name: teammateName },
      { additionalProperties: false },
    ),
  },
  {
    name: "subagent_stop",
    group: "subagents",
    baseRisk: "workspace_write",
    traits: ["write_capable"],
    executionKind: "host",
    label: "subagent_stop",
    description:
      "Stop a teammate's current assignment without deleting its history.",
    parameters: Type.Object(
      { name: teammateName },
      { additionalProperties: false },
    ),
  },
] satisfies ToolDefinition[];
