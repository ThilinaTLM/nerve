import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";
import {
  createScratchNoteRequestSchema,
  scratchNoteSchema,
  updateScratchNoteRequestSchema,
} from "./scratch-note.schema.js";

const okResultSchema = z.object({ ok: z.literal(true) });
const noteIdSchema = z.string().startsWith("note_");
const projectIdSchema = z.string().startsWith("proj_");
const hostRoles = ["workbench_server"] as const;

export const scratchNotesOperationDefinitions = [
  defineOperation(
    "scratchNote.list",
    z.object({ projectId: projectIdSchema }),
    z.object({ notes: z.array(scratchNoteSchema) }),
    "read",
    "none",
    hostRoles,
    "operation.scratchNote.list",
  ),
  defineOperation(
    "scratchNote.create",
    z
      .object({ projectId: projectIdSchema })
      .merge(createScratchNoteRequestSchema),
    z.object({ note: scratchNoteSchema }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.scratchNote.create",
  ),
  defineOperation(
    "scratchNote.update",
    z
      .object({ projectId: projectIdSchema, noteId: noteIdSchema })
      .merge(updateScratchNoteRequestSchema),
    z.object({ note: scratchNoteSchema }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.scratchNote.update",
  ),
  defineOperation(
    "scratchNote.delete",
    z.object({ projectId: projectIdSchema, noteId: noteIdSchema }),
    okResultSchema,
    "mutation",
    "recommended",
    hostRoles,
    "operation.scratchNote.delete",
  ),
] as const;
