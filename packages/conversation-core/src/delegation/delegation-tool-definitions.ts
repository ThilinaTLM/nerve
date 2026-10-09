import {
  toolDefinitionByName,
  type ToolDefinition,
} from "@nervekit/tools/catalog";

export function definition(name: string): ToolDefinition {
  const result = toolDefinitionByName(name);
  if (!result) throw new Error(`Missing tool definition: ${name}`);
  return result;
}

export function childDefinition(name: string): ToolDefinition {
  const base = definition(name);
  if (name === "subagent_new")
    return {
      ...base,
      description:
        "Create an idle child conversation with a unique team name and inherited configuration.",
    };
  if (name === "subagent_list")
    return {
      ...base,
      description: "List your child conversations.",
      parameters: {
        ...base.parameters,
        properties: {},
        required: [],
      } as unknown as ToolDefinition["parameters"],
    };
  const parameters = {
    ...base.parameters,
    properties: {
      name: { type: "string", minLength: 1 },
      conversationId: { type: "string", pattern: "^conv_" },
      ...(name === "subagent_prompt"
        ? {
            prompt: { type: "string", minLength: 1 },
            resume: { type: "boolean" },
            configuration: {
              type: "object",
              additionalProperties: false,
              properties: {
                model: {
                  type: "object",
                  properties: {
                    provider: { type: "string" },
                    modelId: { type: "string" },
                  },
                },
                reasoningLevel: { type: "string" },
                systemPrompt: { type: ["string", "null"] },
                permissionRuleSetId: { type: "string" },
                mode: { enum: ["planning", "coding"] },
                enabledTools: {
                  type: ["array", "null"],
                  items: { type: "string" },
                },
                enabledSkills: {
                  type: ["array", "null"],
                  items: { type: "string" },
                },
                workingDirectory: { type: "string" },
              },
            },
          }
        : {}),
    },
    required: name === "subagent_prompt" ? ["prompt"] : [],
    oneOf: [{ required: ["name"] }, { required: ["conversationId"] }],
  };
  return {
    ...base,
    parameters: parameters as unknown as ToolDefinition["parameters"],
    description:
      name === "subagent_prompt"
        ? "Queue an assignment to your child conversation; optional current configuration applies to its next turn. Paused children require resume=true. Completion notifies you asynchronously."
        : name === "subagent_stop"
          ? "Stop your child conversation and its descendants, preserving history."
          : "Inspect your child conversation.",
  };
}
