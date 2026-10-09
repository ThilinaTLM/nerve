import {
  startTaskRequestSchema,
  taskLogQueryResponseSchema,
  taskLogQuerySchema,
  taskPortConflictListenerSchema,
  taskRecordSchema,
} from "./task.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();
const taskIdSchema = z.string().startsWith("task_");
const taskIdParamsSchema = z.object({ taskId: taskIdSchema });
const taskRestartParamsSchema = taskIdParamsSchema.extend({
  confirmUnverifiedReplacement: z.boolean().optional(),
});
const taskDefinitionLaunchParamsSchema = z.object({
  definitionId: z.string().startsWith("taskdef_"),
  terminateListeners: z.array(taskPortConflictListenerSchema).min(1).optional(),
});

export const taskDefinitionLaunchResultSchema = z.discriminatedUnion(
  "disposition",
  [
    z.object({
      disposition: z.enum(["started", "focused_existing"]),
      task: taskRecordSchema,
    }),
    z.object({
      disposition: z.literal("port_conflict"),
      conflict: z.object({
        port: z.number().int().positive().max(65_535),
        listeners: z.array(taskPortConflictListenerSchema).min(1),
      }),
    }),
  ],
);
export type TaskDefinitionLaunchResult = z.infer<
  typeof taskDefinitionLaunchResultSchema
>;
const taskLogsParamsSchema = taskIdParamsSchema.merge(taskLogQuerySchema);
const taskCancelParamsSchema = taskIdParamsSchema.extend({
  signal: z.enum(["SIGTERM", "SIGINT", "SIGKILL"]).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  reason: z.string().min(1).optional(),
});

export const tasksOperationDefinitions = [
  defineOperation(
    "launch.list",
    emptyParamsSchema,
    z.object({ tasks: z.array(taskRecordSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.launch.list",
  ),
  defineOperation(
    "launch.start",
    startTaskRequestSchema,
    z.object({ task: taskRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.start",
  ),
  defineOperation(
    "launch.launchDefinition",
    taskDefinitionLaunchParamsSchema,
    taskDefinitionLaunchResultSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.launchDefinition",
  ),
  defineOperation(
    "launch.get",
    taskIdParamsSchema,
    z.object({ task: taskRecordSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.launch.get",
  ),
  defineOperation(
    "launch.cancel",
    taskCancelParamsSchema,
    z.object({ task: taskRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.cancel",
  ),
  defineOperation(
    "launch.restart",
    taskRestartParamsSchema,
    z.object({ task: taskRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.restart",
  ),
  defineOperation(
    "launch.prune",
    emptyParamsSchema,
    z.object({ removed: z.array(taskIdSchema) }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.prune",
  ),
  defineOperation(
    "launch.delete",
    taskIdParamsSchema,
    z.object({ removed: z.literal(true) }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.launch.delete",
  ),
  defineOperation(
    "launch.logs",
    taskLogsParamsSchema,
    taskLogQueryResponseSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.launch.logs",
  ),
] as const;
