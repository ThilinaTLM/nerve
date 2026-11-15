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
];
