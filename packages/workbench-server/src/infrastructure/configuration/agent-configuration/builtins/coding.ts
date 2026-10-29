import type { ProfileDefinition } from "@nervekit/contracts/agent-configuration";

/** Lead profile for implementing and validating code changes; the default after plan approval. */
export const coding = {
  schemaVersion: 1,
  name: "coding",
  label: "Coding",
  whenToUse: "Use when the task needs code changes implemented and validated.",
  enabled: true,
  usableBy: "lead",
  instructions: "",
} satisfies ProfileDefinition;
