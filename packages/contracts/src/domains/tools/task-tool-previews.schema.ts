import { z } from "zod";
import {
  taskLogEventSchema,
  taskReadinessSchema,
  taskStatusSchema,
} from "../tasks/index.js";

export const taskCancelOutcomeSchema = z.enum([
  "cancelled",
  "force_cancelled",
  "already_terminal",
  "became_terminal_before_cancel",
  "no_matching_active_task",
]);
export type TaskCancelOutcomePayload = z.infer<typeof taskCancelOutcomeSchema>;

/** Compact, bounded task data used by public tool-call transcript previews. */
export const taskToolSummarySchema = z
  .object({
    id: z.string().startsWith("task_"),
    name: z.string().min(1).optional(),
    cwd: z.string().min(1),
    command: z.string().min(1),
    status: taskStatusSchema,
    readiness: taskReadinessSchema
      .pick({
        outcome: true,
        readyUrl: true,
        readyOnUrl: true,
        matched: true,
      })
      .strict(),
    timing: z
      .object({
        startedAt: z.string().datetime(),
        finishedAt: z.string().datetime().optional(),
      })
      .strict(),
    termination: z
      .object({
        exitCode: z.number().int().nullable().optional(),
        signal: z.string().nullable().optional(),
        error: z.string().optional(),
      })
      .strict()
      .optional(),
    lineage: z
      .object({
        groupId: z.string().startsWith("taskgrp_").optional(),
        restartedFromTaskId: z.string().startsWith("task_").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type TaskToolSummaryPayload = z.infer<typeof taskToolSummarySchema>;

export const taskCancelOutcomePreviewSchema = z
  .object({
    task: taskToolSummarySchema.optional(),
    outcome: taskCancelOutcomeSchema,
    status: taskStatusSchema.optional(),
    message: z.string(),
  })
  .strict();
export type TaskCancelOutcomePreviewPayload = z.infer<
  typeof taskCancelOutcomePreviewSchema
>;

/** Public transcript preview of task_start. */
export const taskStartToolResultPreviewSchema = z
  .object({ task: taskToolSummarySchema })
  .strict();
export type TaskStartToolResultPreview = z.infer<
  typeof taskStartToolResultPreviewSchema
>;

/** Public transcript preview of task_status. */
export const taskStatusToolResultPreviewSchema = z
  .object({ tasks: z.array(taskToolSummarySchema) })
  .strict();
export type TaskStatusToolResultPreview = z.infer<
  typeof taskStatusToolResultPreviewSchema
>;

/** Public transcript preview of task_cancel. */
export const taskCancelToolResultPreviewSchema = z
  .object({ outcomes: z.array(taskCancelOutcomePreviewSchema) })
  .strict();
export type TaskCancelToolResultPreview = z.infer<
  typeof taskCancelToolResultPreviewSchema
>;

/** Public transcript preview of task_restart. */
export const taskRestartToolResultPreviewSchema = z
  .object({
    task: taskToolSummarySchema,
    restartedFromTaskId: z.string().startsWith("task_"),
    newTaskId: z.string().startsWith("task_"),
    restartRootTaskId: z.string().startsWith("task_"),
  })
  .strict();
export type TaskRestartToolResultPreview = z.infer<
  typeof taskRestartToolResultPreviewSchema
>;

/** Public transcript preview of task_logs. */
export const taskLogsToolResultPreviewSchema = z
  .object({
    task: taskToolSummarySchema,
    events: z.array(taskLogEventSchema),
    nextCursor: z.number().int().nonnegative(),
    mode: z.string(),
    previewPath: z.string().min(1).optional(),
    truncated: z.boolean().optional(),
  })
  .strict();
export type TaskLogsToolResultPreview = z.infer<
  typeof taskLogsToolResultPreviewSchema
>;
