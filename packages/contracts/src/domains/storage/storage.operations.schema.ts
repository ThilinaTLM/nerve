import { storageInfoSchema } from "../status/index.js";
import {
  storageCleanupCancelParamsSchema,
  storageCleanupCancelResponseSchema,
  storageCleanupGetParamsSchema,
  storageCleanupRequestSchema,
  storageCleanupStartResponseSchema,
  storageCleanupStatusResponseSchema,
  storageUsageResponseSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();
const countsSchema = z.record(z.string(), z.number().int().nonnegative());

export const storageOperationDefinitions = [
  defineOperation(
    "storage.info",
    emptyParamsSchema,
    storageInfoSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.storage.info",
  ),
  defineOperation(
    "storage.rebuildIndex",
    emptyParamsSchema,
    z.object({ ok: z.literal(true), counts: countsSchema.optional() }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.storage.rebuildIndex",
  ),
  defineOperation(
    "storage.usage.get",
    emptyParamsSchema,
    storageUsageResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.storage.usage.get",
  ),
  defineOperation(
    "storage.cleanup",
    storageCleanupRequestSchema,
    storageCleanupStartResponseSchema,
    "accepted_async",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.storage.cleanup",
  ),
  defineOperation(
    "storage.cleanup.get",
    storageCleanupGetParamsSchema,
    storageCleanupStatusResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.storage.cleanup.get",
  ),
  defineOperation(
    "storage.cleanup.cancel",
    storageCleanupCancelParamsSchema,
    storageCleanupCancelResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.storage.cleanup.cancel",
  ),
] as const;
