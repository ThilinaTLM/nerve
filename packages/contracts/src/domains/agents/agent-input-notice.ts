import { z } from "zod";
import { taskStatusSchema, taskReadinessSchema } from "../tasks/task.js";

/** Human-facing metadata; never provider instructions or an insertion identity. */
export const agentInputNoticeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("task_event"),
    taskId: z.string(),
    taskName: z.string().optional(),
    groupId: z.string().optional(),
    groupName: z.string().optional(),
    event: z.enum([
      "ready",
      "ready_timeout",
      "completed",
      "failed",
      "timed_out",
      "cancelled",
      "orphaned",
      "recovered",
      "interrupted",
      "recovery_unknown",
    ]),
    status: taskStatusSchema,
    readiness: taskReadinessSchema.optional(),
    exitCode: z.number().nullable().optional(),
    signal: z.string().nullable().optional(),
    nextCursor: z.number().optional(),
    commandPreview: z.string().optional(),
    command: z.string().optional(),
    output: z.string().optional(),
    notificationEntryId: z.string().optional(),
  }),
  z.object({
    type: z.literal("subagent_event"),
    childId: z.string(),
    childName: z.string().optional(),
    childRunId: z.string(),
    childAttemptId: z.string().optional(),
    outcome: z.string(),
    notificationEntryId: z.string().optional(),
  }),
  z.object({
    type: z.literal("user_intervention"),
    action: z.string(),
    childId: z.string(),
    sourceId: z.string(),
  }),
  z.object({ type: z.literal("agent_notification") }),
]);
export type AgentInputNotice = z.infer<typeof agentInputNoticeSchema>;
