import { settingsSchema, updateSettingsRequestSchema } from "./index.js";
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
    ["workbench_server", "sandbox_agent"] as const,
    "operation.settings.get",
  ),
  defineOperation(
    "settings.update",
    updateSettingsRequestSchema,
    z.object({ settings: settingsSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.settings.update",
  ),
] as const;
