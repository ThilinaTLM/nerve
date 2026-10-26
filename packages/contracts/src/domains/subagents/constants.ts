/** Largest number of sub-agent assignments accepted in one `subagent_prompt` call. */
export const SUBAGENT_BATCH_LIMIT = 10;
/** Reports up to this size are returned inline; larger ones are read from the report file. */
export const SUBAGENT_REPORT_INLINE_BYTES = 16 * 1024;
/** Recent child activity items included in a `subagent_status` result. */
export const SUBAGENT_STATUS_ACTIVITY_ITEMS = 6;
/** A finished sub-agent folds out of the Agents view after this long. */
export const SUBAGENT_FOLD_AFTER_MS = 10 * 60 * 1000;

/** Tools no sub-agent may use. */
export const subagentBlockedToolNames = [
  "ask_user",
  "plan_present",
  "subagent_prompt",
  "subagent_status",
  "subagent_stop",
] as const;
export type SubagentBlockedToolName = (typeof subagentBlockedToolNames)[number];
