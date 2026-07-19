import { z } from "zod";

export const SCRATCH_NOTE_DEFAULT_TITLE = "Untitled note";
export const SCRATCH_NOTE_TITLE_MAX_LENGTH = 200;
export const SCRATCH_NOTE_CONTENT_MAX_LENGTH = 100_000;

const scratchNoteTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(SCRATCH_NOTE_TITLE_MAX_LENGTH);
const scratchNoteContentSchema = z
  .string()
  .max(SCRATCH_NOTE_CONTENT_MAX_LENGTH);

export const scratchNoteSchema = z.object({
  id: z.string().startsWith("note_"),
  projectId: z.string().startsWith("proj_"),
  title: scratchNoteTitleSchema,
  content: scratchNoteContentSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ScratchNote = z.infer<typeof scratchNoteSchema>;

export const createScratchNoteRequestSchema = z.object({
  title: scratchNoteTitleSchema.optional(),
  content: scratchNoteContentSchema.optional(),
});
export type CreateScratchNoteRequest = z.infer<
  typeof createScratchNoteRequestSchema
>;

export const updateScratchNoteRequestSchema = z
  .object({
    title: scratchNoteTitleSchema.optional(),
    content: scratchNoteContentSchema.optional(),
  })
  .refine(
    (request) => request.title !== undefined || request.content !== undefined,
    {
      message: "A title or content update is required.",
    },
  );
export type UpdateScratchNoteRequest = z.infer<
  typeof updateScratchNoteRequestSchema
>;

export const scratchNotesResponseSchema = z.object({
  notes: z.array(scratchNoteSchema),
});
export type ScratchNotesResponse = z.infer<typeof scratchNotesResponseSchema>;
