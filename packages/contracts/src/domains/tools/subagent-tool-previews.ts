import { z } from "zod";
import {
  subagentOutcomeSchema,
  subagentStateSchema,
} from "../tools/subagent-tools.js";

/**
 * Compact teammate row published in transcript previews. `agentId` is absent
 * only for records produced before teammate ids were exposed to the UI.
 */
export const subagentTeammatePreviewSchema = z
  .object({
    agentId: z.string().optional(),
    name: z.string(),
    state: subagentStateSchema,
    outcome: subagentOutcomeSchema.optional(),
    runId: z.string().optional(),
  })
  .strict();
export type SubagentTeammatePreview = z.infer<
  typeof subagentTeammatePreviewSchema
>;

/** Public transcript preview of subagent_stop. */
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

export const subagentToolResultPreviewSchemas = {
  subagent_stop: subagentTeammateToolResultPreviewSchema,
  subagent_status: subagentStatusToolResultPreviewSchema,
  subagent_prompt: subagentPromptToolResultPreviewSchema,
} as const;

export type SubagentStatusToolResultPreview = z.infer<
  typeof subagentStatusToolResultPreviewSchema
>;
export type SubagentPromptToolResultPreview = z.infer<
  typeof subagentPromptToolResultPreviewSchema
>;
export type SubagentTeammateToolResultPreview = z.infer<
  typeof subagentTeammateToolResultPreviewSchema
>;
