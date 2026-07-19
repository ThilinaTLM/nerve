import type {
  CreateScratchNoteRequest,
  UpdateScratchNoteRequest,
} from "@nervekit/contracts";
import type { OrchestratorState } from "../app/orchestrator-state.js";

type ScratchNoteMethod =
  | "scratchNote.list"
  | "scratchNote.create"
  | "scratchNote.update"
  | "scratchNote.delete";

export async function handleScratchNoteMethod(
  state: OrchestratorState,
  method: ScratchNoteMethod,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "scratchNote.list":
      return {
        notes: await state.registry.listScratchNotes(
          (params as { projectId: string }).projectId,
        ),
      };
    case "scratchNote.create": {
      const request = params as CreateScratchNoteRequest & {
        projectId: string;
      };
      return {
        note: await state.registry.createScratchNote(
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
        note: await state.registry.updateScratchNote(
          request.projectId,
          request.noteId,
          request,
        ),
      };
    }
    case "scratchNote.delete": {
      const request = params as { projectId: string; noteId: string };
      await state.registry.removeScratchNote(request.projectId, request.noteId);
      return { ok: true };
    }
  }
}
