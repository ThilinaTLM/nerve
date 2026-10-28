import type { ToolDefinition } from "@nervekit/tools/catalog";

export function withAgentProfiles(
  tools: ToolDefinition[],
  usable: readonly { name: string; whenToUse: string }[],
  hasExistingSubagents = false,
): ToolDefinition[] {
  if (!usable.length && !hasExistingSubagents)
    return tools.filter((tool) => !tool.name.startsWith("subagent_"));
  return tools.map((tool) => {
    if (tool.name !== "subagent_prompt") return tool;
    const parameters = tool.parameters as unknown as ObjectSchema;
    const assignments = parameters.properties.assignments as AssignmentsSchema;
    const assignmentProperties = usable.length
      ? {
          ...assignments.items.properties,
          profile: {
            type: "string",
            enum: usable.map((entry) => entry.name),
          },
        }
      : Object.fromEntries(
          Object.entries(assignments.items.properties).filter(
            ([name]) => name !== "profile",
          ),
        );
    return {
      ...tool,
      ...(usable.length
        ? {}
        : {
            description:
              "Queue follow-up work for existing sub-agents by name. No profiles are currently usable, so new sub-agents cannot be created. Existing sub-agents keep their configuration and run asynchronously; completion notices wake you.",
          }),
      parameters: {
        ...parameters,
        properties: {
          ...parameters.properties,
          assignments: {
            ...assignments,
            items: {
              ...assignments.items,
              properties: assignmentProperties,
            },
          },
        },
      },
    } as unknown as ToolDefinition;
  });
}

type ObjectSchema = {
  properties: Record<string, unknown>;
};
type AssignmentsSchema = {
  items: ObjectSchema;
};
