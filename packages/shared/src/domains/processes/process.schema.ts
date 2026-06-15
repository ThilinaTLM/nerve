import { z } from "zod";

export const processStatusSchema = z.enum([
  "starting",
  "running",
  "ready",
  "stopping",
  "stopped",
  "exited",
  "error",
  "orphaned",
]);
export type ProcessStatus = z.infer<typeof processStatusSchema>;

export const processReadinessSchema = z.object({
  readyOnUrl: z.boolean().optional(),
  readyPattern: z.string().optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
  outcome: z.enum(["pending", "ready", "timeout", "exited", "none"]),
  matched: z.string().optional(),
  readyAt: z.string().datetime().optional(),
});
export type ProcessReadiness = z.infer<typeof processReadinessSchema>;

export const processRuntimeSchema = z.object({
  platform: z.string().min(1),
  childPid: z.number().int().positive().optional(),
  processGroupId: z.number().int().positive().optional(),
  detached: z.boolean(),
  shell: z.boolean(),
  spawnedAt: z.string().datetime(),
});
export type ProcessRuntime = z.infer<typeof processRuntimeSchema>;

export const processEnvInfoSchema = z.object({
  keys: z.array(z.string().min(1)).default([]),
  persisted: z.boolean(),
  redacted: z.literal(true).default(true),
});
export type ProcessEnvInfo = z.infer<typeof processEnvInfoSchema>;

export const processLaunchConfigSchema = z.object({
  version: z.literal(1),
  env: z.record(z.string(), z.string()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProcessLaunchConfig = z.infer<typeof processLaunchConfigSchema>;

export const processRecordSchema = z.object({
  id: z.string().startsWith("proc_"),
  name: z.string().min(1).optional(),
  workerId: z.string().startsWith("worker_").optional(),
  projectId: z.string().startsWith("proj_").optional(),
  conversationId: z.string().startsWith("conv_").optional(),
  agentId: z.string().startsWith("agent_").optional(),
  cwd: z.string().min(1),
  command: z.string().min(1),
  envInfo: processEnvInfoSchema.optional(),
  status: processStatusSchema,
  readiness: processReadinessSchema,
  stdoutPath: z.string().min(1),
  stderrPath: z.string().min(1),
  logsPath: z.string().min(1),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  exitedAt: z.string().datetime().optional(),
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
  error: z.string().optional(),
  restartedFromProcessId: z.string().startsWith("proc_").optional(),
  runtime: processRuntimeSchema.optional(),
});
export type ProcessRecord = z.infer<typeof processRecordSchema>;

export const startProcessRequestSchema = z.object({
  name: z.string().min(1).optional(),
  workerId: z.string().startsWith("worker_").optional(),
  projectId: z.string().startsWith("proj_").optional(),
  conversationId: z.string().startsWith("conv_").optional(),
  agentId: z.string().startsWith("agent_").optional(),
  cwd: z.string().min(1),
  command: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  readyOnUrl: z.boolean().optional(),
  readyPattern: z.string().min(1).optional(),
  readyTimeoutMs: z.number().int().nonnegative().max(60_000).optional(),
});
export type StartProcessRequest = z.infer<typeof startProcessRequestSchema>;

export const stopProcessRequestSchema = z.object({
  signal: z.enum(["SIGTERM", "SIGINT", "SIGKILL"]).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
});
export type StopProcessRequest = z.infer<typeof stopProcessRequestSchema>;

export const pruneProcessesResponseSchema = z.object({
  removed: z.array(z.string().startsWith("proc_")),
});
export type PruneProcessesResponse = z.infer<
  typeof pruneProcessesResponseSchema
>;

export const processLogEventSchema = z.object({
  seq: z.number().int().positive(),
  ts: z.string().datetime(),
  stream: z.enum(["stdout", "stderr"]),
  level: z.enum(["info", "warn", "error"]),
  line: z.string(),
});
export type ProcessLogEvent = z.infer<typeof processLogEventSchema>;

export const processLogQuerySchema = z.object({
  mode: z
    .enum(["recent", "errors", "warnings", "since_cursor", "first_failure"])
    .optional(),
  sinceSeq: z.number().int().nonnegative().optional(),
  contains: z.string().optional(),
  regex: z.string().optional(),
  contextLines: z.number().int().nonnegative().max(20).optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type ProcessLogQuery = z.infer<typeof processLogQuerySchema>;

export const processLogQueryResponseSchema = z.object({
  process: processRecordSchema,
  events: z.array(processLogEventSchema),
  nextCursor: z.number().int().nonnegative(),
  mode: z.string(),
});
export type ProcessLogQueryResponse = z.infer<
  typeof processLogQueryResponseSchema
>;
