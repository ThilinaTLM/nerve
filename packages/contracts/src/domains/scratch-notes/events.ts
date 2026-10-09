import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";

export const scratchNoteEventDefinitions = [
  definePublicEvent(
    "scratchNote.changed",
    z.object({ projectId: z.string().startsWith("proj_") }),
    { delivery: "ephemeral", scope: ["projectId"] },
  ),
];
