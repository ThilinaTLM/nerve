import { z } from "zod";
import {
  defineContentEvent,
  definePublicEvent,
} from "../../events/definition.js";
import { taskRecordSchema, taskRuntimeSchema } from "./task.js";

// Full task records carry authoritative executable command content, not a
// command preview. Use the existing content-sized event policy without changing
// persisted commands; metadata-only and output events retain the strict guard.
const taskPayloadSchema = z.object({
  task: taskRecordSchema,
  pid: z.number().int().positive().optional(),
  runtime: taskRuntimeSchema.optional(),
  signal: z.string().min(1).max(64).optional(),
  matched: z.string().max(4_096).optional(),
  message: z.string().max(4_096).optional(),
  reason: z.string().max(1_024).optional(),
});

export const launchEventDefinitions = [
  ...[
    "launch.created",
    "launch.started",
    "launch.ready",
    "launch.stop_requested",
    "launch.completed",
    "launch.failed",
    "launch.timed_out",
    "launch.readiness_failed",
    "launch.cancelled",
    "launch.updated",
    "launch.runtime_updated",
  ].map((name) =>
    defineContentEvent(name, taskPayloadSchema, {
      delivery: "ephemeral",
      scope: ["task.id"],
    }),
  ),
  definePublicEvent(
    "launch.removed",
    z.object({ taskId: z.string().startsWith("task_") }),
    { delivery: "ephemeral", scope: ["taskId"] },
  ),
  definePublicEvent(
    "launch.output",
    z.object({
      taskId: z.string().startsWith("task_"),
      stream: z.enum(["stdout", "stderr", "combined"]),
      text: z.string().max(16_384),
    }),
    {
      delivery: "ephemeral",
      coalescing: { strategy: "concat_delta", field: "text", maxChars: 16_384 },
      scope: ["taskId", "stream"],
    },
  ),
];
