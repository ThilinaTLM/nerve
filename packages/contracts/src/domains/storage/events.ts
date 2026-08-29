import { definePublicEvent } from "../../events/definition.js";
import { storageCleanupUpdatedEventSchema } from "./storage.js";

const workbenchRoles = ["workbench_server"] as const;

export const storageEventDefinitions = [
  definePublicEvent(
    "storage.cleanup.updated",
    storageCleanupUpdatedEventSchema,
    {
      allowedSourceRoles: workbenchRoles,
      delivery: "ephemeral",
      coalescing: { strategy: "latest_by_scope" },
      scope: ["operation.id"],
    },
  ),
];
