import { z } from "zod";

export const launchStatusSchema = z.enum([
  "starting",
  "running",
  "ready",
  "stopping",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);
export type LaunchStatus = z.infer<typeof launchStatusSchema>;

export const launchVisibilitySchema = z.enum(["foreground", "background"]);
export type LaunchVisibility = z.infer<typeof launchVisibilitySchema>;

export const launchReadinessSchema = z.object({
  readyUrl: z.string().url().optional(),
  readyOnUrl: z.boolean().optional(),
  readyPattern: z.string().optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
  outcome: z.enum([
    "pending",
    "ready",
    "timeout",
    "exited",
    "unavailable",
    "none",
  ]),
  matched: z.string().optional(),
  readyAt: z.string().datetime().optional(),
});
export type LaunchReadiness = z.infer<typeof launchReadinessSchema>;

export const launchPortConflictListenerSchema = z.object({
  protocol: z.enum(["tcp", "tcp6"]),
  address: z.string().min(1),
  port: z.number().int().positive().max(65_535),
  pid: z.number().int().positive(),
  identity: z.string().min(1),
  processName: z.string().min(1).optional(),
});
export type LaunchPortConflictListener = z.infer<
  typeof launchPortConflictListenerSchema
>;

export const launchListeningPortSchema = z.object({
  protocol: z.enum(["tcp", "tcp6"]),
  address: z.string().min(1),
  port: z.number().int().positive().max(65_535),
  pid: z.number().int().positive().optional(),
  processGroupId: z.number().int().positive().optional(),
  processStartTimeTicks: z.number().int().nonnegative().optional(),
  detectedAt: z.string().datetime(),
});
export type LaunchListeningPort = z.infer<typeof launchListeningPortSchema>;

export const launchRuntimeIdentitySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("linux"),
    startTimeTicks: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("darwin"),
    startFingerprint: z.string().startsWith("darwin:"),
  }),
  z.object({
    kind: z.literal("win32"),
    creationDate: z.string().startsWith("win32:"),
  }),
]);
export type LaunchRuntimeIdentity = z.infer<typeof launchRuntimeIdentitySchema>;

export const launchRuntimeSchema = z.object({
  version: z.literal(2),
  platform: z.string().min(1),
  childPid: z.number().int().positive(),
  processGroupId: z.number().int().positive().optional(),
  detached: z.boolean(),
  shell: z.boolean(),
  containment: z.enum(["job-object", "process-group"]),
  spawnedAt: z.string().datetime(),
  identity: launchRuntimeIdentitySchema,
  listeningPorts: z.array(launchListeningPortSchema).optional(),
  capabilities: z.object({
    identity: z.boolean(),
    processTree: z.boolean(),
    listeningPorts: z.boolean(),
    detail: z.string().optional(),
  }),
});
export type LaunchRuntime = z.infer<typeof launchRuntimeSchema>;

export const launchEnvInfoSchema = z.object({
  keys: z.array(z.string().min(1)).default([]),
  persisted: z.boolean(),
  redacted: z.literal(true).default(true),
});
export type LaunchEnvInfo = z.infer<typeof launchEnvInfoSchema>;

export const launchOutputRetentionSchema = z.object({
  totalBytes: z.number().int().nonnegative(),
  retainedBytes: z.number().int().nonnegative(),
  omittedBytes: z.number().int().nonnegative(),
  totalLines: z.number().int().nonnegative(),
  retainedLines: z.number().int().nonnegative(),
  omittedLines: z.number().int().nonnegative(),
  headMaxBytes: z.number().int().positive(),
  tailMaxBytes: z.number().int().positive(),
  truncated: z.boolean(),
  tailPath: z.string().min(1).optional(),
});
export type LaunchOutputRetention = z.infer<typeof launchOutputRetentionSchema>;

export const launchRecordSchema = z.object({
  id: z.string().startsWith("launch_"),
  definitionId: z.string().startsWith("launchdef_").optional(),
  name: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  groupId: z.string().startsWith("launchgrp_").optional(),
  groupName: z.string().min(1).optional(),
  projectId: z.string().startsWith("proj_").optional(),
  cwd: z.string().min(1),
  command: z.string().min(1),
  envInfo: launchEnvInfoSchema.optional(),
  status: launchStatusSchema,
  readiness: launchReadinessSchema,
  stdoutPath: z.string().min(1),
  stderrPath: z.string().min(1),
  combinedPath: z.string().min(1).optional(),
  logsPath: z.string().min(1),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
  error: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  restartedFromLaunchId: z.string().startsWith("launch_").optional(),
  restartRootLaunchId: z.string().startsWith("launch_").optional(),
  restartGeneration: z.number().int().nonnegative().optional(),
  runtime: launchRuntimeSchema.optional(),
  outputRetention: launchOutputRetentionSchema.optional(),
  visibility: launchVisibilitySchema.default("background"),
});
export type LaunchRecord = z.infer<typeof launchRecordSchema>;

export const startLaunchRequestSchema = z.object({
  definitionId: z.string().startsWith("launchdef_").optional(),
  definitionRunPolicy: z.enum(["single", "concurrent"]).optional(),
  name: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  groupId: z.string().startsWith("launchgrp_").optional(),
  groupName: z.string().min(1).optional(),
  projectId: z.string().startsWith("proj_").optional(),
  cwd: z.string().min(1),
  command: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  readyUrl: z.string().url().optional(),
  readyOnUrl: z.boolean().optional(),
  readyPattern: z.string().min(1).optional(),
  readyTimeoutMs: z.number().int().nonnegative().max(60_000).optional(),
  timeoutMs: z.number().int().positive().max(86_400_000).optional(),
});
export type StartLaunchRequest = z.infer<typeof startLaunchRequestSchema>;

export const cancelLaunchRequestSchema = z.object({
  signal: z.enum(["SIGTERM", "SIGINT", "SIGKILL"]).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  reason: z.string().min(1).optional(),
});
export type CancelLaunchRequest = z.infer<typeof cancelLaunchRequestSchema>;

export const pruneLaunchesResponseSchema = z.object({
  removed: z.array(z.string().startsWith("launch_")),
});
export type PruneLaunchesResponse = z.infer<typeof pruneLaunchesResponseSchema>;

export const launchLogEventSchema = z.object({
  seq: z.number().int().positive(),
  ts: z.string().datetime(),
  stream: z.enum(["stdout", "stderr"]),
  level: z.enum(["info", "warn", "error"]),
  line: z.string(),
  raw: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      terminatorBytes: z.number().int().nonnegative().max(2),
      fidelity: z.enum(["captured", "reconstructed"]),
    })
    .optional(),
});
export type LaunchLogEvent = z.infer<typeof launchLogEventSchema>;

export const launchLogQuerySchema = z
  .object({
    mode: z
      .enum(["recent", "errors", "warnings", "since_cursor", "first_failure"])
      .optional(),
    sinceSeq: z.number().int().nonnegative().optional(),
    beforeSeq: z.number().int().nonnegative().optional(),
    contains: z.string().optional(),
    regex: z.string().optional(),
    contextLines: z.number().int().nonnegative().max(20).optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .superRefine((query, context) => {
    const mode = query.mode ?? "recent";
    if (mode === "since_cursor" && query.beforeSeq !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["beforeSeq"],
        message: "since_cursor cannot use beforeSeq.",
      });
    }
    if (mode !== "since_cursor" && query.sinceSeq !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["sinceSeq"],
        message: `${mode} cannot use sinceSeq.`,
      });
    }
    if (mode === "first_failure" && query.beforeSeq !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["beforeSeq"],
        message: "first_failure cannot use a directional cursor.",
      });
    }
  });
export type LaunchLogQuery = z.infer<typeof launchLogQuerySchema>;

export const launchLogQueryResponseSchema = z.object({
  launch: launchRecordSchema,
  events: z.array(launchLogEventSchema),
  nextCursor: z.number().int().nonnegative(),
  firstSeq: z.number().int().positive().optional(),
  lastSeq: z.number().int().positive().optional(),
  hasMoreBefore: z.boolean(),
  hasMoreAfter: z.boolean(),
  olderBeforeSeq: z.number().int().positive().optional(),
  futureSinceSeq: z.number().int().nonnegative().optional(),
  originalEventCount: z.number().int().nonnegative().optional(),
  displayedEventCount: z.number().int().nonnegative().optional(),
  omittedEventCount: z.number().int().nonnegative().optional(),
  streamArtifacts: z
    .object({
      stdoutPath: z.string().min(1),
      stderrPath: z.string().min(1),
      eventsPath: z.string().min(1),
      combinedPath: z.string().min(1).optional(),
      fidelity: z.enum(["captured", "reconstructed"]),
    })
    .optional(),
  mode: z.string(),
  previewPath: z.string().min(1).optional(),
  truncated: z.boolean().optional(),
  outputRetention: launchOutputRetentionSchema.optional(),
});
export type LaunchLogQueryResponse = z.infer<
  typeof launchLogQueryResponseSchema
>;
