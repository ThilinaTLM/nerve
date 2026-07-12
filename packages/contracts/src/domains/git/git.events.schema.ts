import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";

export const gitEventDefinitions = [
  definePublicEvent(
    "git.repository.changed",
    z.object({
      projectId: z.string().startsWith("proj_").optional(),
      repo: z.string().min(1).max(1_024),
      reason: z.string().min(1).max(128),
      head: z
        .object({
          branch: z.string().max(256).optional(),
          oid: z.string().max(128).optional(),
        })
        .optional(),
    }),
    { scope: ["projectId", "repo"] },
  ),
];
