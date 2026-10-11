import { z } from "zod";

/** Largest number of sub-agent assignments accepted in one `subagent_prompt` call. */
export const SUBAGENT_BATCH_LIMIT = 10;
/** Reports up to this size are returned inline; larger ones are read from the report file. */
export const SUBAGENT_REPORT_INLINE_BYTES = 16 * 1024;
/** Upper bound for profile instructions and for a conversation's `instructions`. */
export const SUBAGENT_INSTRUCTIONS_MAX_BYTES = 16 * 1024;
/** Recent child activity items included in a `subagent_status` result. */
export const SUBAGENT_STATUS_ACTIVITY_ITEMS = 6;
/** A finished sub-agent folds out of the Agents view after this long. */
export const SUBAGENT_FOLD_AFTER_MS = 10 * 60 * 1000;

export const SUBAGENT_PROFILE_NAME_MAX_LENGTH = 32;
export const SUBAGENT_PROFILE_LABEL_MAX_LENGTH = 80;
export const SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH = 200;

/** Tools no sub-agent may use and no profile may name. */
export const subagentBlockedToolNames = [
  "ask_user",
  "plan_mode_enter",
  "plan_mode_present",
  "plan_mode_force_exit",
  "subagent_prompt",
  "subagent_status",
  "subagent_stop",
] as const;
export type SubagentBlockedToolName = (typeof subagentBlockedToolNames)[number];

/** Rule sets a profile may select; any rule set with "ask" rules would bring back a human in the loop. */
export const subagentPermissionRuleSetIds = [
  "read_only",
  "autonomous",
] as const;
export const subagentPermissionRuleSetIdSchema = z.enum(
  subagentPermissionRuleSetIds,
);
export type SubagentPermissionRuleSetId = z.infer<
  typeof subagentPermissionRuleSetIdSchema
>;

export const subagentProfileNameSchema = z
  .string()
  .min(1)
  .max(SUBAGENT_PROFILE_NAME_MAX_LENGTH)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Name must use lowercase letters, numbers, and single hyphens",
  );
export type SubagentProfileName = z.infer<typeof subagentProfileNameSchema>;

/** UTF-8 byte length, the unit of the instruction limit. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Instructions text for a profile or a conversation, bounded by UTF-8 bytes. */
export const subagentInstructionsSchema = z
  .string()
  .refine((value) => utf8ByteLength(value) <= SUBAGENT_INSTRUCTIONS_MAX_BYTES, {
    message: `Instructions must be at most ${SUBAGENT_INSTRUCTIONS_MAX_BYTES} bytes`,
  });
