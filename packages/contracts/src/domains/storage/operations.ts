import { maintenanceStartResponseSchema } from "../maintenance/maintenance.js";
import { storageInfoSchema } from "../status/status.js";
import {
  storageCleanupRequestSchema,
  storageUsageResponseSchema,
} from "./storage.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();

export const storageOperationDefinitions = [
  defineOperation(
    "storage.info",
    emptyParamsSchema,
    storageInfoSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.storage.info",
  ),
  defineOperation(
    "storage.rebuildIndex",
    emptyParamsSchema,
    maintenanceStartResponseSchema,
    "accepted_async",
    "recommended",
    ["workbench_server"] as const,
    "operation.storage.rebuildIndex",
  ),
  defineOperation(
    "storage.usage.get",
    emptyParamsSchema,
    storageUsageResponseSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.storage.usage.get",
  ),
  defineOperation(
    "storage.cleanup",
    storageCleanupRequestSchema,
    maintenanceStartResponseSchema,
    "accepted_async",
    "recommended",
    ["workbench_server"] as const,
    "operation.storage.cleanup",
  ),
] as const;
