import {
  type CreateScratchNoteRequest,
  type ScratchNote,
  scratchNoteSchema,
  scratchNotesResponseSchema,
  type UpdateScratchNoteRequest,
} from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

export async function listScratchNotes(
  projectId: string,
): Promise<ScratchNote[]> {
  const result = (await protocolRequest("scratchNote.list", { projectId }))
    .result;
  return scratchNotesResponseSchema.parse(result).notes;
}

export async function createScratchNote(
  projectId: string,
  request: CreateScratchNoteRequest = {},
): Promise<ScratchNote> {
  const note = (
    await protocolRequest("scratchNote.create", { projectId, ...request })
  ).result.note;
  return scratchNoteSchema.parse(note);
}

export async function updateScratchNote(
  projectId: string,
  noteId: string,
  request: UpdateScratchNoteRequest,
): Promise<ScratchNote> {
  const note = (
    await protocolRequest("scratchNote.update", {
      projectId,
      noteId,
      ...request,
    })
  ).result.note;
  return scratchNoteSchema.parse(note);
}

export async function deleteScratchNote(
  projectId: string,
  noteId: string,
): Promise<void> {
  await protocolRequest("scratchNote.delete", { projectId, noteId });
}
