import type {
  CreateScratchNoteRequest,
  UpdateScratchNoteRequest,
} from "@nervekit/contracts/scratch-notes";
import type { ServerRuntime } from "../../app/runtime/server-runtime.js";

type ScratchNoteMethod =
  | "scratchNote.list"
  | "scratchNote.create"
  | "scratchNote.update"
  | "scratchNote.delete";

export async function handleScratchNoteMethod(
  state: Pick<ServerRuntime, "services">,
  method: ScratchNoteMethod,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "scratchNote.list":
      return {
        notes: await state.services.scratchNotes.list(
          (params as { projectId: string }).projectId,
        ),
      };
    case "scratchNote.create": {
      const request = params as CreateScratchNoteRequest & {
        projectId: string;
      };
      return {
        note: await state.services.scratchNotes.create(
          request.projectId,
          request,
        ),
      };
    }
    case "scratchNote.update": {
      const request = params as UpdateScratchNoteRequest & {
        projectId: string;
        noteId: string;
      };
      return {
        note: await state.services.scratchNotes.update(
          request.projectId,
          request.noteId,
          request,
        ),
      };
    }
    case "scratchNote.delete": {
      const request = params as { projectId: string; noteId: string };
      await state.services.scratchNotes.remove(
        request.projectId,
        request.noteId,
      );
      return { ok: true };
    }
  }
}
