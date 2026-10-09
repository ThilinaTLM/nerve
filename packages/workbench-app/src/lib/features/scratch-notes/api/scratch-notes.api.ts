import {
  type CreateScratchNoteRequest,
  type ScratchNote,
  scratchNoteSchema,
  scratchNotesResponseSchema,
  type UpdateScratchNoteRequest,
} from "@nervekit/contracts/scratch-notes";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export async function listScratchNotes(
  projectId: string,
): Promise<ScratchNote[]> {
  const result = await requestWorkbench("scratchNote.list", { projectId });
  return scratchNotesResponseSchema.parse(result).notes;
}

export async function createScratchNote(
  projectId: string,
  request: CreateScratchNoteRequest = {},
): Promise<ScratchNote> {
  const note = (
    await requestWorkbench("scratchNote.create", { projectId, ...request })
  ).note;
  return scratchNoteSchema.parse(note);
}

export async function updateScratchNote(
  projectId: string,
  noteId: string,
  request: UpdateScratchNoteRequest,
): Promise<ScratchNote> {
  const note = (
    await requestWorkbench("scratchNote.update", {
      projectId,
      noteId,
      ...request,
    })
  ).note;
  return scratchNoteSchema.parse(note);
}

export async function deleteScratchNote(
  projectId: string,
  noteId: string,
): Promise<void> {
  await requestWorkbench("scratchNote.delete", { projectId, noteId });
}
