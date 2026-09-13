import { maintenanceStartResponseSchema } from "../maintenance/maintenance.js";
import { storageInfoSchema } from "../status/status.js";
import {
  storageCleanupRequestSchema,
  storageUsageResponseSchema,
} from "./storage.js";
import { z } from "zod";
import { portableBackupManifestSchema } from "./durable-recovery.js";
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
    "storage.backup.create",
    emptyParamsSchema,
    z.object({ manifest: portableBackupManifestSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.storage.backup.create",
  ),
  defineOperation(
    "storage.backup.inspect",
    z.object({ backupId: z.string().startsWith("backup_").max(256) }),
    z.object({ manifest: portableBackupManifestSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.storage.backup.inspect",
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
