import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
export const launchDefinitionEventDefinitions = [
  definePublicEvent(
    "launchCatalog.changed",
    z.object({
      projectId: z.string().startsWith("proj_"),
      revision: z.string(),
    }),
    { scope: ["projectId"] },
  ),
];
