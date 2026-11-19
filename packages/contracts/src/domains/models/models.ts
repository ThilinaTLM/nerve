import { z } from "zod";

export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const thinkingLevelSchema = z.enum(thinkingLevels).meta({
  description:
    "Reasoning effort. A level the selected model does not support is adjusted, or a conflict when required.",
});
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

export const modelSelectionSchema = z.object({
  provider: z.string().min(1).meta({
    description:
      "Provider id from the user's configured models. Never guess it.",
  }),
  modelId: z.string().min(1).meta({
    description: "Model id from the user's configured models. Never guess it.",
  }),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const modelInputSchema = z.enum(["text", "image"]);
export type ModelInputModality = z.infer<typeof modelInputSchema>;

export const modelInfoSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  name: z.string(),
  label: z.string(),
  reasoning: z.boolean().default(false),
  /** Accepted input modalities; `["text", "image"]` means vision input works. */
  input: z.array(modelInputSchema).default(["text"]),
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
