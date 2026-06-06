import { z } from "zod";

export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export const thinkingLevelSchema = z.enum(thinkingLevels);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

export const modelSelectionSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const modelInfoSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  label: z.string(),
  reasoning: z.boolean().default(false),
  supportedThinkingLevels: z.array(thinkingLevelSchema).default(["off"]),
  faux: z.boolean().optional(),
  contextWindow: z.number().int().nonnegative().default(0),
  maxOutputTokens: z.number().int().nonnegative().default(0),
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;

/**
 * Per-conversation context-window usage.
 *
 * `tokens`/`percent` are `null` when the current usage is unknown (e.g. right
 * after a compaction, until the next assistant response), or when the model's
 * context window is unknown (`contextWindow <= 0`).
 */
export const contextUsageSchema = z.object({
  tokens: z.number().int().nonnegative().nullable(),
  contextWindow: z.number().int().nonnegative(),
  percent: z.number().nullable(),
});
export type ContextUsage = z.infer<typeof contextUsageSchema>;
