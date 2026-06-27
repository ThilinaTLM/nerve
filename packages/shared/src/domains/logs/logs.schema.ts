import { z } from "zod";

export const applicationLogLevelSchema = z.enum([
  "debug",
  "info",
  "warn",
  "error",
]);
export type ApplicationLogLevel = z.infer<typeof applicationLogLevelSchema>;

export const applicationLogSourceSchema = z.enum([
  "orchestrator",
  "desktop",
  "web",
  "cli",
]);
export type ApplicationLogSource = z.infer<typeof applicationLogSourceSchema>;

export const applicationLogErrorSchema = z.object({
  name: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
  cause: z.string().optional(),
});
export type ApplicationLogError = z.infer<typeof applicationLogErrorSchema>;

export const applicationLogRecordSchema = z.object({
  seq: z.number().int().positive(),
  id: z.string().startsWith("log_"),
  ts: z.string().datetime(),
  level: applicationLogLevelSchema,
  source: applicationLogSourceSchema,
  component: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().optional(),
  projectId: z.string().startsWith("proj_").optional(),
  conversationId: z.string().startsWith("conv_").optional(),
  agentId: z.string().startsWith("agent_").optional(),
  runId: z.string().startsWith("run_").optional(),
  toolCallId: z.string().startsWith("tool_").optional(),
  taskId: z.string().startsWith("task_").optional(),
  workerId: z.string().startsWith("worker_").optional(),
  durationMs: z.number().nonnegative().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  error: applicationLogErrorSchema.optional(),
});
export type ApplicationLogRecord = z.infer<typeof applicationLogRecordSchema>;

export const daemonCrashReportKindSchema = z.enum([
  "uncaughtException",
  "unhandledRejection",
  "childExit",
  "startupExit",
  "startupTimeout",
  "startupError",
]);
export type DaemonCrashReportKind = z.infer<typeof daemonCrashReportKindSchema>;

export const daemonCrashReportSchema = z.object({
  id: z.string().startsWith("crash_"),
  ts: z.string().datetime(),
  source: applicationLogSourceSchema,
  kind: daemonCrashReportKindSchema,
  message: z.string().min(1),
  pid: z.number().int().positive().optional(),
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
  uptimeMs: z.number().int().nonnegative().optional(),
  dataDir: z.string().optional(),
  error: applicationLogErrorSchema.optional(),
  outputTail: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  runtime: z
    .object({
      node: z.string(),
      platform: z.string(),
      arch: z.string(),
    })
    .optional(),
});
export type DaemonCrashReport = z.infer<typeof daemonCrashReportSchema>;

export const applicationLogQuerySchema = z.object({
  level: applicationLogLevelSchema.optional(),
  source: applicationLogSourceSchema.optional(),
  component: z.string().min(1).optional(),
  contains: z.string().optional(),
  sinceSeq: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(500).optional(),
  requestId: z.string().optional(),
  projectId: z.string().startsWith("proj_").optional(),
  conversationId: z.string().startsWith("conv_").optional(),
  agentId: z.string().startsWith("agent_").optional(),
  runId: z.string().startsWith("run_").optional(),
  toolCallId: z.string().startsWith("tool_").optional(),
  taskId: z.string().startsWith("task_").optional(),
  workerId: z.string().startsWith("worker_").optional(),
});
export type ApplicationLogQuery = z.infer<typeof applicationLogQuerySchema>;

export const applicationLogQueryResponseSchema = z.object({
  logs: z.array(applicationLogRecordSchema),
  nextCursor: z.number().int().nonnegative(),
});
export type ApplicationLogQueryResponse = z.infer<
  typeof applicationLogQueryResponseSchema
>;

export const applicationLogPruneRequestSchema = applicationLogQuerySchema.omit({
  limit: true,
  sinceSeq: true,
});
export type ApplicationLogPruneRequest = z.infer<
  typeof applicationLogPruneRequestSchema
>;

export const applicationLogPruneResponseSchema = z.object({
  pruned: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});
export type ApplicationLogPruneResponse = z.infer<
  typeof applicationLogPruneResponseSchema
>;

export const clientApplicationLogRequestSchema = z.object({
  logs: z
    .array(
      applicationLogRecordSchema
        .omit({
          seq: true,
          id: true,
          ts: true,
          source: true,
        })
        .extend({
          ts: z.string().datetime().optional(),
          source: z.literal("web").optional(),
        }),
    )
    .min(1)
    .max(50),
});
export type ClientApplicationLogRequest = z.infer<
  typeof clientApplicationLogRequestSchema
>;
