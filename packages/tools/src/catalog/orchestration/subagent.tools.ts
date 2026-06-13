import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const subagentRunParameters = Type.Object(
  {
    task: Type.String({ description: "Task for the child agent" }),
    context: Type.Optional(
      Type.String({ description: "Useful context for the child agent" }),
    ),
    mode: Type.Optional(
      Type.Union([Type.Literal("planning"), Type.Literal("coding")]),
    ),
    permissionLevel: Type.Optional(
      Type.Union([
        Type.Literal("read_only"),
        Type.Literal("supervised"),
        Type.Literal("autonomous"),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const subagentToolDefinitions = [
  {
    name: "subagent_run",
    label: "subagent_run",
    description:
      "Spawn a child agent to investigate an independent task with bounded authority.",
    promptSnippet: "Run a bounded child agent for independent investigation",
    promptGuidelines: [
      "Use subagent_run only for substantial independent investigations, not simple lookups.",
    ],
    parameters: subagentRunParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
