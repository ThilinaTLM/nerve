import { z } from "zod";

export const projectInstructionFileSchema = z
  .object({
    /** Absolute instruction file path, using the host platform's path syntax. */
    path: z.string().min(1),
    /** Absolute directory whose subtree receives these instructions. */
    appliesTo: z.string().min(1),
  })
  .strict();
export type ProjectInstructionFile = z.infer<
  typeof projectInstructionFileSchema
>;
export const projectInstructionsListParamsSchema = z
  .object({ projectId: z.string().min(1) })
  .strict();
export type ProjectInstructionsListParams = z.infer<
  typeof projectInstructionsListParamsSchema
>;
export const projectInstructionsListResultSchema = z
  .object({ files: z.array(projectInstructionFileSchema) })
  .strict();
export type ProjectInstructionsListResult = z.infer<
  typeof projectInstructionsListResultSchema
>;
