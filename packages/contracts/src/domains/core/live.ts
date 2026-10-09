import { z } from "zod";

export const toolProgressSchema = z.object({
  chunk: z.string(),
  stream: z.enum(["stdout", "stderr"]).optional(),
});
export const liveDeltaSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assistant_text"),
    turnId: z.string(),
    contentIndex: z.number().int().nonnegative(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("assistant_thinking"),
    turnId: z.string(),
    contentIndex: z.number().int().nonnegative(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_arguments"),
    turnId: z.string(),
    contentIndex: z.number().int().nonnegative(),
    providerCallId: z.string(),
    name: z.string(),
    partialArgsText: z.string(),
  }),
  z.object({
    type: z.literal("tool_progress"),
    toolCallId: z.string(),
    update: toolProgressSchema,
  }),
  z.object({ type: z.literal("execution_activity"), activity: z.string() }),
]);
export type ToolProgress = z.infer<typeof toolProgressSchema>;
export type LiveDelta = z.infer<typeof liveDeltaSchema>;
