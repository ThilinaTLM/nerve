import { z } from "zod";
import { modelContextJournalEntrySchema } from "../conversations/conversation-journal.js";

/** Temporary immutable source used only by historical shared-root partition migration. */
export const agentContextPrefixMigrationSchema = z.object({
  sourceRevision: z.number().int().nonnegative(),
  entries: z.array(modelContextJournalEntrySchema),
  leafId: z.string().nullable(),
});
export type AgentContextPrefixMigration = z.infer<
  typeof agentContextPrefixMigrationSchema
>;
