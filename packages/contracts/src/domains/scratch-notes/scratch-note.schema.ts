import { z } from "zod";

export const scratchNoteSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  content: z.string(),
  updatedAt: z.string().datetime(),
});
export type ScratchNote = z.infer<typeof scratchNoteSchema>;

export const updateScratchNoteRequestSchema = z.object({
  content: z.string().max(100_000),
});
export type UpdateScratchNoteRequest = z.infer<
  typeof updateScratchNoteRequestSchema
>;
