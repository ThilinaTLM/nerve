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

export const asyncBashLogsRequestSchema = z.object({
  conversationId: z.string(),
  bashId: z.string(),
  // Byte offsets; omitted streams start at the tail of their file.
  offsets: z
    .object({
      combined: z.number().int().nonnegative().optional(),
      stdout: z.number().int().nonnegative().optional(),
      stderr: z.number().int().nonnegative().optional(),
    })
    .optional(),
  // Total byte budget across all returned streams.
  limit: z.number().int().positive().max(65536).optional(),
});
export const asyncBashLogsResponseSchema = z.object({
  bash: asyncBashSchema,
  streams: z.array(
    z.object({
      stream: z.enum(["combined", "stdout", "stderr"]),
      text: z.string(),
      offset: z.number().int().nonnegative(),
      nextOffset: z.number().int().nonnegative(),
      totalBytes: z.number().int().nonnegative(),
    }),
  ),
});
export type AsyncBashLogsRequest = z.infer<typeof asyncBashLogsRequestSchema>;
export type AsyncBashLogsResponse = z.infer<typeof asyncBashLogsResponseSchema>;
