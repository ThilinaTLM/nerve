import type { AgentResultProfileId } from "@nervekit/contracts/tools";

export type ProjectionBudget = Readonly<{
  maxBytes: number;
  maxLines: number;
  maxContentLines?: number;
  maxItems?: number;
  maxItemBytes?: number;
}>;

export type AgentResultProfile = Readonly<{
  inline: ProjectionBudget;
  overflow: ProjectionBudget;
}>;

const budget = (
  maxLines: number,
  maxBytes: number,
  options: Omit<ProjectionBudget, "maxLines" | "maxBytes"> = {},
): ProjectionBudget => Object.freeze({ maxLines, maxBytes, ...options });

export const AGENT_RESULT_PROFILES: Readonly<
  Record<AgentResultProfileId, AgentResultProfile>
> = Object.freeze({
  source_text: {
    inline: budget(202, 24_000, { maxContentLines: 200 }),
    overflow: budget(202, 24_000, { maxContentLines: 200 }),
  },
  process_diagnostics: {
    inline: budget(84, 12_000),
    overflow: budget(16, 4_000, { maxItems: 8, maxItemBytes: 1_000 }),
  },
  search_matches: { inline: budget(80, 16_000), overflow: budget(80, 16_000) },
  file_listing: {
    inline: budget(120, 12_000, { maxItems: 120 }),
    overflow: budget(120, 12_000, { maxItems: 120 }),
  },
  search_summaries: {
    inline: budget(120, 12_000, { maxItems: 10 }),
    overflow: budget(120, 12_000, { maxItems: 10 }),
  },
  network_prose: { inline: budget(120, 16_000), overflow: budget(12, 3_000) },
  resource_detail: {
    inline: budget(160, 16_000),
    overflow: budget(160, 16_000),
  },
  mutation_acknowledgement: {
    inline: budget(40, 4_000),
    overflow: budget(40, 4_000),
  },
  lifecycle_state: { inline: budget(80, 8_000), overflow: budget(80, 8_000) },
  task_logs: {
    inline: budget(60, 10_000, { maxItems: 60, maxItemBytes: 512 }),
    overflow: budget(60, 10_000, { maxItems: 60, maxItemBytes: 512 }),
  },
  delegated_reports: {
    inline: budget(60, 6_000),
    overflow: budget(12, 3_000, { maxItemBytes: 512 }),
  },
  primary_file_result: {
    inline: budget(80, 8_000),
    overflow: budget(12, 3_000),
  },
  human_response: {
    inline: budget(202, 24_000, { maxContentLines: 200 }),
    overflow: budget(202, 24_000, { maxContentLines: 200 }),
  },
  vision_explanation: {
    inline: budget(100, 12_000),
    overflow: budget(100, 12_000),
  },
  terminal_outcome: { inline: budget(40, 4_000), overflow: budget(40, 4_000) },
  conservative_fallback: {
    inline: budget(200, 24_000),
    overflow: budget(200, 24_000),
  },
});

for (const profile of Object.values(AGENT_RESULT_PROFILES)) {
  Object.freeze(profile);
}

export function profileBudget(
  profile: AgentResultProfileId,
  kind: "inline" | "overflow",
): ProjectionBudget {
  return AGENT_RESULT_PROFILES[profile][kind];
}
