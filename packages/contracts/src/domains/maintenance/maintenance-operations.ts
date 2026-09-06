import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import {
  maintenanceStartResponseSchema,
  maintenanceStatusResponseSchema,
} from "./maintenance.js";
export const maintenanceOperationDefinitions = [
  defineOperation(
    "maintenance.get",
    z.object({}).optional(),
    maintenanceStatusResponseSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.maintenance.get",
  ),
  defineOperation(
    "maintenance.cancel",
    z.object({ operationId: z.string() }),
    maintenanceStartResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.maintenance.cancel",
  ),
] as const;
