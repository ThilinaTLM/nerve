import { scratchNoteSchema } from "@nervekit/contracts";
import type { ScratchNote } from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

export async function getScratchNote(projectId: string): Promise<ScratchNote> {
  const note = (await protocolRequest("scratchNote.get", { projectId })).result
    .note;
  return scratchNoteSchema.parse(note);
}

export async function updateScratchNote(
  projectId: string,
  content: string,
): Promise<ScratchNote> {
  const note = (
    await protocolRequest("scratchNote.update", { projectId, content })
  ).result.note;
  return scratchNoteSchema.parse(note);
}
