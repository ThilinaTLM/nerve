import { z } from "zod";
import { autoCompactionSettingsSchema } from "../settings/settings.js";

/** Conversation-level harness overrides stored in the conversation's `harness.json`. */
export const conversationHarnessSettingsSchema = z
  .object({ compaction: autoCompactionSettingsSchema.optional() })
  .strict();
export type ConversationHarnessSettings = z.infer<
  typeof conversationHarnessSettingsSchema
>;

export const harnessCompactionSourceSchema = z.enum([
  "user",
  "project",
  "conversation",
]);
export type HarnessCompactionSource = z.infer<
  typeof harnessCompactionSourceSchema
>;

export const conversationHarnessSettingsResultSchema = z.object({
  compaction: z.object({
    effective: autoCompactionSettingsSchema,
    source: harnessCompactionSourceSchema,
    /** What the conversation would use without its own override. */
    inherited: autoCompactionSettingsSchema,
  }),
});
export type ConversationHarnessSettingsResult = z.infer<
  typeof conversationHarnessSettingsResultSchema
>;
