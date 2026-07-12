import { definePublicEvent } from "../events/event-definition.schema.js";
import { storageCleanupUpdatedEventSchema } from "./storage.schema.js";

const workbenchRoles = ["workbench_server"] as const;

export const storageEventDefinitions = [
  definePublicEvent(
    "storage.cleanup.updated",
    storageCleanupUpdatedEventSchema,
    {
      allowedSourceRoles: workbenchRoles,
      durability: "transient",
      coalescing: "latest_by_scope",
      scope: ["operation.id"],
    },
  ),
];
