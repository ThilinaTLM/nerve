/** Canonical schema versions and managed migration ordinals are separate histories. */
export const CANONICAL_SCHEMA_STEP_IDS: Readonly<Record<number, string>> = {
  1: "0001-nerve-home-v1",
  2: "0002-atomic-run-lifecycle-work",
  3: "0003-authoritative-run-lifecycle",
  4: "0004-convert-run-lifecycle",
  5: "0005-async-subagent-completions",
  6: "0006-explore-agent-names",
  7: "0007-agent-async-obligations",
  8: "0012-run-initial-input-lookup",
};
