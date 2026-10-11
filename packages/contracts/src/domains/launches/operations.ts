import {
  startLaunchRequestSchema,
  launchLogQueryResponseSchema,
  launchLogQuerySchema,
  launchPortConflictListenerSchema,
  launchRecordSchema,
} from "./launch.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();
const launchIdSchema = z.string().startsWith("launch_");
const launchIdParamsSchema = z.object({ launchId: launchIdSchema });
const launchRestartParamsSchema = launchIdParamsSchema.extend({});
const launchStartDefinitionParamsSchema = z.object({
  definitionId: z.string().startsWith("launchdef_"),
  terminateListeners: z
    .array(launchPortConflictListenerSchema)
    .min(1)
    .optional(),
});

export const launchStartDefinitionResultSchema = z.discriminatedUnion(
  "disposition",
  [
    z.object({
      disposition: z.enum(["started", "focused_existing"]),
      launch: launchRecordSchema,
    }),
    z.object({
      disposition: z.literal("port_conflict"),
      conflict: z.object({
        port: z.number().int().positive().max(65_535),
        listeners: z.array(launchPortConflictListenerSchema).min(1),
      }),
    }),
  ],
);
export type LaunchStartDefinitionResult = z.infer<
  typeof launchStartDefinitionResultSchema
>;
const launchLogsParamsSchema = launchIdParamsSchema.merge(launchLogQuerySchema);
const launchCancelParamsSchema = launchIdParamsSchema.extend({
  signal: z.enum(["SIGTERM", "SIGINT", "SIGKILL"]).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  reason: z.string().min(1).optional(),
});

export const launchesOperationDefinitions = [
  defineOperation(
    "launch.list",
    emptyParamsSchema,
    z.object({ launches: z.array(launchRecordSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.launch.list",
  ),
  defineOperation(
    "launch.start",
    startLaunchRequestSchema,
    z.object({ launch: launchRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.start",
  ),
  defineOperation(
    "launch.startDefinition",
    launchStartDefinitionParamsSchema,
    launchStartDefinitionResultSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.startDefinition",
  ),
  defineOperation(
    "launch.get",
    launchIdParamsSchema,
    z.object({ launch: launchRecordSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.launch.get",
  ),
  defineOperation(
    "launch.cancel",
    launchCancelParamsSchema,
    z.object({ launch: launchRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.cancel",
  ),
  defineOperation(
    "launch.restart",
    launchRestartParamsSchema,
    z.object({ launch: launchRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.restart",
  ),
  defineOperation(
    "launch.prune",
    emptyParamsSchema,
    z.object({ removed: z.array(launchIdSchema) }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.prune",
  ),
  defineOperation(
    "launch.delete",
    launchIdParamsSchema,
    z.object({ removed: z.literal(true) }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.delete",
  ),
  defineOperation(
    "launch.logs",
    launchLogsParamsSchema,
    launchLogQueryResponseSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.launch.logs",
  ),
] as const;
