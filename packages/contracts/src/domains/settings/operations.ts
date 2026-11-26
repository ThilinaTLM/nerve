import {
  applicationConfigurationSnapshotSchema,
  updateApplicationConfigurationRequestSchema,
} from "./application-configuration.js";
import {
  titleTestResultSchema,
  settingsSchema,
  updateSettingsRequestSchema,
} from "./settings.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();

export const settingsOperationDefinitions = [
  defineOperation(
    "conversationTitles.test",
    z.strictObject({}).optional(),
    titleTestResultSchema,
    "mutation",
    ["workbench_server"] as const,
    "operation.conversationTitles.test",
  ),
  defineOperation(
    "settings.get",
    emptyParamsSchema,
    settingsSchema,
    "read",
    ["workbench_server"] as const,
    "operation.settings.get",
  ),
  defineOperation(
    "settings.update",
    updateSettingsRequestSchema,
    z.object({ settings: settingsSchema }),
    "mutation",
    ["workbench_server"] as const,
    "operation.settings.update",
  ),
  defineOperation(
    "applicationConfiguration.get",
    emptyParamsSchema,
    applicationConfigurationSnapshotSchema,
    "read",
    ["workbench_server"] as const,
    "operation.applicationConfiguration.get",
  ),
  defineOperation(
    "applicationConfiguration.update",
    updateApplicationConfigurationRequestSchema,
    applicationConfigurationSnapshotSchema,
    "mutation",
    ["workbench_server"] as const,
    "operation.applicationConfiguration.update",
  ),
] as const;
