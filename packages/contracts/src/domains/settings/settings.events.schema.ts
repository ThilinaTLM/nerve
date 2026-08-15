import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";
import { applicationConfigurationSnapshotSchema } from "./application-configuration.schema.js";
import { settingsSchema } from "./settings.schema.js";

const workbenchRoles = ["workbench_server"] as const;

export const settingsEventDefinitions = [
  definePublicEvent(
    "settings.updated",
    z.object({ settings: settingsSchema }),
    { allowedSourceRoles: workbenchRoles },
  ),
  definePublicEvent(
    "applicationConfiguration.updated",
    z.object({ snapshot: applicationConfigurationSnapshotSchema }),
    { allowedSourceRoles: workbenchRoles },
  ),
];
