import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";

export const filesystemEventDefinitions = [
  definePublicEvent(
    "filesystem.project.changed",
    z.object({
      projectId: z.string().startsWith("proj_"),
      source: z.literal("filesystem"),
    }),
    {
      delivery: "ephemeral",
      coalescing: { strategy: "latest_by_scope" },
      scope: ["projectId"],
    },
  ),
] as const;
