import {
  applicationConfigurationSnapshotSchema,
  settingsSchema,
  updateApplicationConfigurationRequestSchema,
  updateSettingsRequestSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();

export const settingsOperationDefinitions = [
  defineOperation(
    "settings.get",
    emptyParamsSchema,
    settingsSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.settings.get",
  ),
  defineOperation(
    "settings.update",
    updateSettingsRequestSchema,
    z.object({ settings: settingsSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.settings.update",
  ),
  defineOperation(
    "applicationConfiguration.get",
    emptyParamsSchema,
    applicationConfigurationSnapshotSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.applicationConfiguration.get",
  ),
  defineOperation(
    "applicationConfiguration.update",
    updateApplicationConfigurationRequestSchema,
    applicationConfigurationSnapshotSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.applicationConfiguration.update",
  ),
] as const;
