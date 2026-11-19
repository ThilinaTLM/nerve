import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
import { extensionTargetSchema } from "./extension-operations.js";

export const extensionEventDefinitions = [
  /** Any scope's extension settings changed; clients re-read the views they show. */
  definePublicEvent(
    "extensions.changed",
    z.object({ scope: extensionTargetSchema }),
    { allowedSourceRoles: ["workbench_server"] },
  ),
  /** A key of an extension's store in a project changed (frame or backend write); `revision` `null`: deleted. */
  definePublicEvent(
    "extensions.store.changed",
    z.object({
      projectId: z.string().min(1),
      extensionId: z.string().min(1),
      key: z.string().min(1),
      revision: z.number().int().positive().nullable(),
      /** The `origin` of the frame request that wrote it; absent for backend writes. */
      origin: z.string().optional(),
    }),
    {
      allowedSourceRoles: ["workbench_server"],
      delivery: "ephemeral",
      scope: ["projectId"],
    },
  ),
];
