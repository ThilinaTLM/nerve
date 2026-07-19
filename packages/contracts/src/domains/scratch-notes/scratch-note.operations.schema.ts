import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";
import {
  scratchNoteSchema,
  updateScratchNoteRequestSchema,
} from "./scratch-note.schema.js";

const projectIdSchema = z.string().startsWith("proj_");
const hostRoles = ["workbench_server"] as const;

export const scratchNotesOperationDefinitions = [
  defineOperation(
    "scratchNote.get",
    z.object({ projectId: projectIdSchema }),
    z.object({ note: scratchNoteSchema }),
    "read",
    "none",
    hostRoles,
    "operation.scratchNote.get",
  ),
  defineOperation(
    "scratchNote.update",
    z
      .object({ projectId: projectIdSchema })
      .merge(updateScratchNoteRequestSchema),
    z.object({ note: scratchNoteSchema }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.scratchNote.update",
  ),
] as const;
