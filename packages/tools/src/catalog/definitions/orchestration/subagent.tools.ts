import { Type } from "typebox";
import type { ToolDefinition } from "../../contracts.js";

const childTarget = {
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  agentId: Type.Optional(Type.String({ pattern: "^agent_" })),
};
// Preserve an object root while requiring exactly one child target.
const childTargetOptions = {
  additionalProperties: false,
  oneOf: [{ required: ["name"] }, { required: ["agentId"] }],
};
export const subagentToolDefinitions = [
  {
    name: "subagent_new",
    group: "subagents",
    baseRisk: "agent_spawn",
    traits: ["write_capable"],
    executionKind: "host",
    label: "subagent_new",
    description:
      "Create an idle reusable developer teammate with a unique team name and inherited authority. An explicitly user-approved spawn may grant autonomous coding authority, but never bypasses a read-only preset ceiling.",
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
      "Assign or steer one owned child: agentId (including Explore) or case-insensitive developer teammate name, never both. Running children accept durable next-turn input after their tool batch settles; stopped children require resume=true. Optional configuration applies next turn under the delegated configure grant and parent/workspace ceilings: model, thinkingLevel, tools, skills, instructions, systemPrompt, mode, permissionLevel, permissionRuleSetId, projectDir, workspaceScope. Include findings, paths, constraints and expected outcomes: children cannot see your conversation but share the worktree and retain their own context.",
    parameters: Type.Object(
      {
        ...childTarget,
        prompt: Type.String({ minLength: 1 }),
        resume: Type.Optional(Type.Boolean()),
        configuration: Type.Optional(
          Type.Record(
            Type.String({
              pattern:
                "^(model|thinkingLevel|tools|skills|instructions|systemPrompt|mode|permissionLevel|permissionRuleSetId|projectDir|workspaceScope)$",
            }),
            Type.Unknown(),
            { additionalProperties: false },
          ),
        ),
      },
      childTargetOptions,
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
      "Inspect an owned child's state and, when idle, last response/run. Supply agentId (including Explore) or case-insensitive developer name, never both.",
    parameters: Type.Object({ ...childTarget }, childTargetOptions),
  },
  {
    name: "subagent_stop",
    group: "subagents",
    baseRisk: "workspace_write",
    traits: ["write_capable"],
    executionKind: "host",
    label: "subagent_stop",
    description:
      "Pause an owned child, preserving history and pending input until explicit resume. Supply agentId (including Explore) or case-insensitive developer name, never both.",
    parameters: Type.Object({ ...childTarget }, childTargetOptions),
  },
] satisfies ToolDefinition[];
