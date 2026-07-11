import {
  startTaskRequestSchema,
  taskLogQueryResponseSchema,
  taskLogQuerySchema,
  taskRecordSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();
const taskIdSchema = z.string().startsWith("task_");
const taskIdParamsSchema = z.object({ taskId: taskIdSchema });
const taskLogsParamsSchema = taskIdParamsSchema.merge(taskLogQuerySchema);
const taskCancelParamsSchema = taskIdParamsSchema.extend({
  signal: z.enum(["SIGTERM", "SIGINT", "SIGKILL"]).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  reason: z.string().min(1).optional(),
});

export const tasksOperationDefinitions = [
  defineOperation(
    "task.list",
    emptyParamsSchema,
    z.object({ tasks: z.array(taskRecordSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.task.list",
  ),
  defineOperation(
    "task.start",
    startTaskRequestSchema,
    z.object({ task: taskRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.task.start",
  ),
  defineOperation(
    "task.get",
    taskIdParamsSchema,
    z.object({ task: taskRecordSchema }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.task.get",
  ),
  defineOperation(
    "task.cancel",
    taskCancelParamsSchema,
    z.object({ task: taskRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.task.cancel",
  ),
  defineOperation(
    "task.restart",
    taskIdParamsSchema,
    z.object({ task: taskRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.task.restart",
  ),
  defineOperation(
    "task.prune",
    emptyParamsSchema,
    z.object({ removed: z.array(taskIdSchema) }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.task.prune",
  ),
  defineOperation(
    "task.delete",
    taskIdParamsSchema,
    z.object({ removed: z.literal(true) }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.task.delete",
  ),
  defineOperation(
    "task.logs",
    taskLogsParamsSchema,
    taskLogQueryResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.task.logs",
  ),
] as const;
