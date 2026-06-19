import { z } from "zod";

export const taskStatusSchema = z.enum([
  "starting",
  "running",
  "ready",
  "stopping",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskVisibilitySchema = z.enum(["foreground", "background"]);
export type TaskVisibility = z.infer<typeof taskVisibilitySchema>;

export const taskReadinessSchema = z.object({
  readyUrl: z.string().url().optional(),
  readyOnUrl: z.boolean().optional(),
  readyPattern: z.string().optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
  outcome: z.enum(["pending", "ready", "timeout", "exited", "none"]),
  matched: z.string().optional(),
  readyAt: z.string().datetime().optional(),
});
export type TaskReadiness = z.infer<typeof taskReadinessSchema>;

export const taskRuntimeSchema = z.object({
  platform: z.string().min(1),
  childPid: z.number().int().positive().optional(),
  processGroupId: z.number().int().positive().optional(),
  detached: z.boolean(),
  shell: z.boolean(),
  spawnedAt: z.string().datetime(),
});
export type TaskRuntime = z.infer<typeof taskRuntimeSchema>;

export const taskEnvInfoSchema = z.object({
  keys: z.array(z.string().min(1)).default([]),
  persisted: z.boolean(),
  redacted: z.literal(true).default(true),
});
export type TaskEnvInfo = z.infer<typeof taskEnvInfoSchema>;

export const taskLaunchConfigSchema = z.object({
  version: z.literal(1),
  env: z.record(z.string(), z.string()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskLaunchConfig = z.infer<typeof taskLaunchConfigSchema>;

export const taskOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("api") }),
  z.object({ kind: z.literal("utility_panel") }),
  z.object({
    kind: z.literal("agent_tool"),
    toolCallId: z.string().startsWith("tool_"),
    providerToolCallId: z.string().min(1).optional(),
    runId: z.string().startsWith("run_").optional(),
    turnId: z.string().startsWith("turn_").optional(),
    liveMessageId: z.string().startsWith("msg_").optional(),
    contentIndex: z.number().int().nonnegative().optional(),
  }),
]);
export type TaskOrigin = z.infer<typeof taskOriginSchema>;

export const taskCompletionInjectionSchema = z.object({
  inject: z.boolean().default(false),
  entryId: z.string().startsWith("entry_").optional(),
  injectedAt: z.string().datetime().optional(),
  outputTailLineCount: z.number().int().positive().max(200).default(80),
});
export type TaskCompletionInjection = z.infer<
  typeof taskCompletionInjectionSchema
>;

export const taskNotificationStateSchema = z.object({
  enabled: z.boolean().default(false),
  ready: z.boolean().default(false),
  terminal: z.boolean().default(false),
  readyEntryId: z.string().startsWith("entry_").optional(),
  terminalEntryId: z.string().startsWith("entry_").optional(),
  readyDeliveredAt: z.string().datetime().optional(),
  terminalDeliveredAt: z.string().datetime().optional(),
  outputTailLineCount: z.number().int().positive().max(200).default(80),
});
export type TaskNotificationState = z.infer<typeof taskNotificationStateSchema>;

export const taskRecordSchema = z.object({
  id: z.string().startsWith("task_"),
  name: z.string().min(1).optional(),
  groupId: z.string().startsWith("taskgrp_").optional(),
  groupName: z.string().min(1).optional(),
  workerId: z.string().startsWith("worker_").optional(),
  projectId: z.string().startsWith("proj_").optional(),
  conversationId: z.string().startsWith("conv_").optional(),
  agentId: z.string().startsWith("agent_").optional(),
  cwd: z.string().min(1),
  command: z.string().min(1),
  envInfo: taskEnvInfoSchema.optional(),
  status: taskStatusSchema,
  readiness: taskReadinessSchema,
  stdoutPath: z.string().min(1),
  stderrPath: z.string().min(1),
  logsPath: z.string().min(1),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
  error: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  restartedFromTaskId: z.string().startsWith("task_").optional(),
  legacyProcessId: z.string().startsWith("proc_").optional(),
  runtime: taskRuntimeSchema.optional(),
  origin: taskOriginSchema.default({ kind: "api" }),
  completion: taskCompletionInjectionSchema.optional(),
  notifications: taskNotificationStateSchema.optional(),
  visibility: taskVisibilitySchema.default("background"),
});
export type TaskRecord = z.infer<typeof taskRecordSchema>;

export const startTaskRequestSchema = z.object({
  name: z.string().min(1).optional(),
  groupId: z.string().startsWith("taskgrp_").optional(),
  groupName: z.string().min(1).optional(),
  workerId: z.string().startsWith("worker_").optional(),
  projectId: z.string().startsWith("proj_").optional(),
  conversationId: z.string().startsWith("conv_").optional(),
  agentId: z.string().startsWith("agent_").optional(),
  cwd: z.string().min(1),
  command: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  readyUrl: z.string().url().optional(),
  readyOnUrl: z.boolean().optional(),
  readyPattern: z.string().min(1).optional(),
  readyTimeoutMs: z.number().int().nonnegative().max(60_000).optional(),
  timeoutMs: z.number().int().positive().max(86_400_000).optional(),
  notify: z.boolean().optional(),
  injectCompletion: z.boolean().optional(),
});
export type StartTaskRequest = z.infer<typeof startTaskRequestSchema>;

export const cancelTaskRequestSchema = z.object({
  signal: z.enum(["SIGTERM", "SIGINT", "SIGKILL"]).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  reason: z.string().min(1).optional(),
});
export type CancelTaskRequest = z.infer<typeof cancelTaskRequestSchema>;

export const pruneTasksResponseSchema = z.object({
  removed: z.array(z.string().startsWith("task_")),
});
export type PruneTasksResponse = z.infer<typeof pruneTasksResponseSchema>;

export const taskLogEventSchema = z.object({
  seq: z.number().int().positive(),
  ts: z.string().datetime(),
  stream: z.enum(["stdout", "stderr"]),
  level: z.enum(["info", "warn", "error"]),
  line: z.string(),
});
export type TaskLogEvent = z.infer<typeof taskLogEventSchema>;

export const taskLogQuerySchema = z.object({
  mode: z
    .enum(["recent", "errors", "warnings", "since_cursor", "first_failure"])
    .optional(),
  sinceSeq: z.number().int().nonnegative().optional(),
  contains: z.string().optional(),
  regex: z.string().optional(),
  contextLines: z.number().int().nonnegative().max(20).optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type TaskLogQuery = z.infer<typeof taskLogQuerySchema>;

export const taskLogQueryResponseSchema = z.object({
  task: taskRecordSchema,
  events: z.array(taskLogEventSchema),
  nextCursor: z.number().int().nonnegative(),
  mode: z.string(),
  previewPath: z.string().min(1).optional(),
  truncated: z.boolean().optional(),
});
export type TaskLogQueryResponse = z.infer<typeof taskLogQueryResponseSchema>;
