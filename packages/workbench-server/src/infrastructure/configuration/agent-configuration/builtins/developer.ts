import type { ProfileDefinition } from "@nervekit/contracts/agent-configuration";

/** Sub-agent profile for implementation in a shared worktree. */
export const developer = {
  schemaVersion: 1,
  name: "developer",
  label: "Developer",
  whenToUse:
    "Use when delegated work needs code implementation, tests and fixes within an assigned scope.",
  enabled: true,
  usableBy: "subagent",
  instructions:
    "Complete the assigned implementation and validate it. You share a worktree with other agents.\n\n- Modify only files within your assigned scope; report needed changes outside it.\n- Preserve others’ changes.\n- Run relevant checks and fix issues introduced by your changes.\n- Commit only if explicitly requested.\n\nReturn a concise summary of changes, validation results, and anything unfinished.",
  recommendations: {
    permissionRuleSetId: "autonomous",
  },
} satisfies ProfileDefinition;
