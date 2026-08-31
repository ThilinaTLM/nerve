import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
import {
  taskListeningPortSchema,
  taskRecordSchema,
  taskRuntimeSchema,
} from "./task.js";

const workbenchRoles = ["workbench_server"] as const;
const cleanupMethodSchema = z.enum([
  "job-object",
  "process-group",
  "process-tree",
  "direct-child",
  "taskkill",
  "none",
]);
const taskSignalSchema = z.enum(["SIGTERM", "SIGINT", "SIGKILL"]);

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
    "task.recovered",
    "task.interrupted",
    "task.recovery_unknown",
    "task.updated",
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
      delivery: "ephemeral",
      coalescing: {
        strategy: "concat_delta",
        field: "text",
        maxChars: 16_384,
      },
      scope: ["taskId", "stream"],
    },
  ),
  ...["task.promoted", "task.runtime_updated"].map((name) =>
    definePublicEvent(name, z.object({ task: taskRecordSchema }), {
      allowedSourceRoles: workbenchRoles,
      scope: ["task.id"],
    }),
  ),
  definePublicEvent(
    "task.orphan_cleanup_succeeded",
    z.object({
      task: taskRecordSchema,
      runtime: taskRuntimeSchema,
      signal: taskSignalSchema,
      method: cleanupMethodSchema.optional(),
      releasedPorts: z.array(taskListeningPortSchema).max(256).optional(),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["task.id"] },
  ),
  definePublicEvent(
    "task.cleanup_failed",
    z.object({
      task: taskRecordSchema,
      error: z.string().min(1).max(4_096),
      orphaned: z.literal(true),
      method: cleanupMethodSchema.optional(),
      signal: taskSignalSchema.optional(),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["task.id"] },
  ),
];
