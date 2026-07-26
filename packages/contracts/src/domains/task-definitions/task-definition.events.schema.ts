import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";
import { taskDefinitionSchema } from "./task-definition.schema.js";

export const taskDefinitionEventDefinitions = [
  ...["taskDefinition.created", "taskDefinition.updated"].map((name) =>
    definePublicEvent(name, z.object({ definition: taskDefinitionSchema }), {
      scope: ["definition.id"],
    }),
  ),
  definePublicEvent(
    "taskDefinition.deleted",
    z.object({ definitionId: z.string().startsWith("taskdef_") }),
    { scope: ["definitionId"] },
  ),
];
