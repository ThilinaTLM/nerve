import type {
  CreateScratchNoteRequest,
  UpdateScratchNoteRequest,
} from "@nervekit/contracts/scratch-notes";
import type { ServerAdapterContexts } from "../../app/bootstrap/create-server-adapter-contexts.js";

type ScratchNoteMethod =
  | "scratchNote.list"
  | "scratchNote.create"
  | "scratchNote.update"
  | "scratchNote.delete";

export async function handleScratchNoteMethod(
  state: Pick<ServerAdapterContexts["protocol"]["projects"], "scratchNotes">,
  method: ScratchNoteMethod,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "scratchNote.list":
      return {
        notes: await state.scratchNotes.list(
          (params as { projectId: string }).projectId,
        ),
      };
    case "scratchNote.create": {
      const request = params as CreateScratchNoteRequest & {
        projectId: string;
      };
      return {
        note: await state.scratchNotes.create(request.projectId, request),
      };
    }
    case "scratchNote.update": {
      const request = params as UpdateScratchNoteRequest & {
        projectId: string;
        noteId: string;
      };
      return {
        note: await state.scratchNotes.update(
          request.projectId,
          request.noteId,
          request,
        ),
      };
    }
    case "scratchNote.delete": {
      const request = params as { projectId: string; noteId: string };
      await state.scratchNotes.remove(request.projectId, request.noteId);
      return { ok: true };
    }
  }
}
