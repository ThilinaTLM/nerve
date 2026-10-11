import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
import { launchDefinitionSchema } from "./launch-definition.js";

export const launchDefinitionEventDefinitions = [
  ...["launchDefinition.created", "launchDefinition.updated"].map((name) =>
    definePublicEvent(name, z.object({ definition: launchDefinitionSchema }), {
      scope: ["definition.id"],
    }),
  ),
  definePublicEvent(
    "launchDefinition.deleted",
    z.object({ definitionId: z.string().startsWith("launchdef_") }),
    { scope: ["definitionId"] },
  ),
];
