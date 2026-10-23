/** Authored v1 bytes; not a legacy converter. Digests bind these exact bytes. */
export const bundledAgentProfiles: Readonly<Record<string, string>> = {
  planning: JSON.stringify({
    schemaVersion: 1,
    name: "planning",
    label: "Planning",
    description: "Research and present an implementation plan.",
    enabled: true,
    usableBy: "lead",
    instructions:
      "Before anything else, read {{skill:planning}} and follow it.",
    requirements: {
      permissionRuleSetId: "planning",
      tools: { plan_present: { enabled: true } },
    },
  }),
  coding: JSON.stringify({
    schemaVersion: 1,
    name: "coding",
    label: "Coding",
    description: "Implement and validate changes.",
    enabled: true,
    usableBy: "lead",
    instructions:
      "In the final response, summarize changes, validation, and remaining limits.",
  }),
};
