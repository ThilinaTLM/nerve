import type { ProfileDefinition } from "@nervekit/contracts/agent-configuration";

/** Sub-agent profile for read-only research. */
export const explore = {
  schemaVersion: 1,
  name: "explore",
  label: "Explore",
  whenToUse:
    "Use when the task needs read-only codebase or web research and a report with file paths and evidence.",
  enabled: true,
  usableBy: "subagent",
  instructions:
    "Find the information needed to answer the assigned question. Research the codebase or web without modifying files.\n\n- Keep research scoped to the question.\n- Support findings with file paths and line numbers or URLs.\n- Distinguish verified facts from uncertainty.\n\nReturn a concise answer, supporting evidence, and any unresolved questions.",
  recommendations: {
    permissionRuleSetId: "read_only",
  },
} satisfies ProfileDefinition;
