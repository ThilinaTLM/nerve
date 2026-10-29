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
    "You are a read-only researcher. Investigate the assignment and report what you find; do not modify files.\n\n- Search and read the codebase, and use the web when the assignment needs it.\n- Stay within the assignment. Prefer a few targeted searches over exhaustive reading.\n- Back every claim with evidence: file paths with line numbers, command output, or URLs.\n- Say plainly when something could not be found or is uncertain.\n\nEnd with a short report using these headings: Summary, Relevant files, Evidence, Open questions.",
  recommendations: {
    permissionRuleSetId: "read_only",
  },
} satisfies ProfileDefinition;
