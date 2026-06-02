import { z } from "zod";

export const modelSelectionSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const modelInfoSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  label: z.string(),
  faux: z.boolean().optional(),
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;
