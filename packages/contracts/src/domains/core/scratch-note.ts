import { z } from "zod";

export const scratchNoteSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ScratchNote = z.infer<typeof scratchNoteSchema>;
