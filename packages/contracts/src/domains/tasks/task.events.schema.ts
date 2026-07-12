import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";
import { taskRecordSchema, taskRuntimeSchema } from "./task.schema.js";

const taskPayloadSchema = z.object({
  task: taskRecordSchema,
  pid: z.number().int().positive().optional(),
  runtime: taskRuntimeSchema.optional(),
  signal: z.string().min(1).max(64).optional(),
  matched: z.string().max(4_096).optional(),
  message: z.string().max(4_096).optional(),
  reason: z.string().max(1_024).optional(),
});

export const taskEventDefinitions = [
  ...[
    "task.created",
    "task.started",
    "task.ready",
    "task.stop_requested",
    "task.completed",
    "task.failed",
    "task.timed_out",
    "task.readiness_failed",
    "task.cancelled",
    "task.orphaned",
  ].map((name) =>
    definePublicEvent(name, taskPayloadSchema, { scope: ["task.id"] }),
  ),
  definePublicEvent(
    "task.removed",
    z.object({ taskId: z.string().startsWith("task_") }),
    { scope: ["taskId"] },
  ),
  definePublicEvent(
    "task.output",
    z.object({
      taskId: z.string().startsWith("task_"),
      stream: z.enum(["stdout", "stderr", "combined"]),
      text: z.string().max(16_384),
    }),
    {
      durability: "transient",
      coalescing: "concat_delta",
      scope: ["taskId", "stream"],
    },
  ),
];
