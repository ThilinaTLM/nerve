import type { AgentResultProfileId } from "@nervekit/contracts/tools";
import { DEFAULT_MAX_BYTES } from "../execution/output/truncate.js";

export type ProjectionBudget = Readonly<{
  maxBytes: number;
  maxLines: number;
  maxContentLines?: number;
  maxItems?: number;
  maxItemBytes?: number;
  /** Share of a head/tail view given to the head; the rest goes to the tail. */
  headShare?: number;
}>;

/** Process output: size decides; the line ceiling only guards many-short-line output. */
const PROCESS_OVERFLOW = { maxLines: 200, maxBytes: 8_000, headShare: 0.2 };

/** `read` already bounds pages to 50 KiB; leave room for its range and continuation notices. */
const SOURCE_TEXT_MAX_BYTES = DEFAULT_MAX_BYTES + 2_048;
const SOURCE_TEXT_MAX_LINES = 5_010;

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
    inline: budget(SOURCE_TEXT_MAX_LINES, SOURCE_TEXT_MAX_BYTES),
    overflow: budget(SOURCE_TEXT_MAX_LINES, SOURCE_TEXT_MAX_BYTES),
  },
  process_diagnostics: {
    inline: budget(400, 12_000),
    overflow: budget(PROCESS_OVERFLOW.maxLines, PROCESS_OVERFLOW.maxBytes, {
      headShare: PROCESS_OVERFLOW.headShare,
    }),
  },
  script_output: {
    inline: budget(600, 24_000),
    overflow: budget(PROCESS_OVERFLOW.maxLines, PROCESS_OVERFLOW.maxBytes, {
      headShare: PROCESS_OVERFLOW.headShare,
    }),
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
