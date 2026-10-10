import { z } from "zod";

export const asyncBashStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "lost",
]);
export const asyncBashSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  toolCallId: z.string(),
  command: z.string(),
  workingDirectory: z.string(),
  status: asyncBashStatusSchema,
  processRef: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type AsyncBashStatus = z.infer<typeof asyncBashStatusSchema>;
export type AsyncBash = z.infer<typeof asyncBashSchema>;
