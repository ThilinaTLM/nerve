import { maintenanceStartResponseSchema } from "../maintenance/maintenance.js";
import { storageInfoSchema } from "../status/status.js";
import {
  storageCleanupRequestSchema,
  storageUsageResponseSchema,
} from "./storage.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();
/** `force` rescans now; otherwise the last scan is returned while one exists. */
const storageUsageParamsSchema = z
  .object({ force: z.boolean().optional() })
  .optional();

export const storageOperationDefinitions = [
  defineOperation(
    "storage.info",
    emptyParamsSchema,
    storageInfoSchema,
    "read",
    ["workbench_server"] as const,
    "operation.storage.info",
  ),
  defineOperation(
    "storage.usage.get",
    storageUsageParamsSchema,
    storageUsageResponseSchema,
    "read",
    ["workbench_server"] as const,
    "operation.storage.usage.get",
  ),
  defineOperation(
    "storage.cleanup",
    storageCleanupRequestSchema,
    maintenanceStartResponseSchema,
    "accepted_async",
    ["workbench_server"] as const,
    "operation.storage.cleanup",
  ),
] as const;
