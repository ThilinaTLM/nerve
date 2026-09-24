import { z } from "zod";
import {
  asyncSubagentOutcomeSchema,
  asyncSubagentStateSchema,
} from "../agents/async-subagents.js";

/** Teammates retained by the subagent_list transcript preview. */
export const SUBAGENT_LIST_PREVIEW_COUNT = 5;

/**
 * Compact teammate row published in transcript previews. `agentId` is absent
 * only for records produced before teammate ids were exposed to the UI.
 */
export const subagentTeammatePreviewSchema = z
  .object({
    agentId: z.string().optional(),
    name: z.string(),
    state: asyncSubagentStateSchema,
    outcome: asyncSubagentOutcomeSchema.optional(),
    runId: z.string().optional(),
  })
  .strict();
export type SubagentTeammatePreview = z.infer<
  typeof subagentTeammatePreviewSchema
>;

/** Public transcript preview of subagent_new and subagent_stop. */
export const subagentTeammateToolResultPreviewSchema = z
  .object({ teammate: subagentTeammatePreviewSchema })
  .strict();

/** Public transcript preview of subagent_status. */
export const subagentStatusToolResultPreviewSchema = z
  .object({
    teammate: subagentTeammatePreviewSchema,
    response: z
      .object({ text: z.string(), complete: z.boolean(), runId: z.string() })
      .strict()
      .optional(),
  })
  .strict();

/** Public transcript preview of subagent_prompt. */
export const subagentPromptToolResultPreviewSchema = z
  .object({ teammate: subagentTeammatePreviewSchema, runId: z.string() })
  .strict();

/** Public transcript preview of subagent_list. */
export const subagentListToolResultPreviewSchema = z
  .object({
    teammates: z
      .array(subagentTeammatePreviewSchema)
      .max(SUBAGENT_LIST_PREVIEW_COUNT),
    more: z.boolean(),
  })
  .strict();

export const subagentToolResultPreviewSchemas = {
  subagent_new: subagentTeammateToolResultPreviewSchema,
  subagent_stop: subagentTeammateToolResultPreviewSchema,
  subagent_status: subagentStatusToolResultPreviewSchema,
  subagent_prompt: subagentPromptToolResultPreviewSchema,
  subagent_list: subagentListToolResultPreviewSchema,
} as const;

export type SubagentStatusToolResultPreview = z.infer<
  typeof subagentStatusToolResultPreviewSchema
>;
export type SubagentPromptToolResultPreview = z.infer<
  typeof subagentPromptToolResultPreviewSchema
>;
export type SubagentListToolResultPreview = z.infer<
  typeof subagentListToolResultPreviewSchema
>;
export type SubagentTeammateToolResultPreview = z.infer<
  typeof subagentTeammateToolResultPreviewSchema
>;
