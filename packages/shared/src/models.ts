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
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;
