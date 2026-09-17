import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";

export const filesystemEventDefinitions = [
  definePublicEvent(
    "filesystem.project.changed",
    z.object({
      projectId: z.string().startsWith("proj_"),
      generation: z.number().int().nonnegative(),
      directories: z.array(z.string().max(4_096)).max(256),
      fullRefreshRequired: z.boolean(),
    }),
    {
      delivery: "ephemeral",
      coalescing: { strategy: "latest_by_scope" },
      scope: ["projectId"],
    },
  ),
] as const;
