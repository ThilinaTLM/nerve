import { z } from "zod";

export const EXECUTION_WORKER_PROTOCOL_VERSION = 1 as const;
export const EXECUTION_WORKER_MAX_FRAME_BYTES = 4 * 1024 * 1024;

export const workerExecutionIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

export const workerTargetSchema = z
  .object({
    pid: z.number().int().positive().safe(),
    processGroupId: z.number().int().positive().safe().optional(),
    containment: z.string().min(1).max(64),
    identity: z.string().min(1).max(256),
  })
  .strict();
export type WorkerTarget = z.infer<typeof workerTargetSchema>;

export const workerExecutionStatusSchema = z.enum([
  "starting",
  "running",
  "completed",
  "failed",
]);
export type WorkerExecutionStatus = z.infer<typeof workerExecutionStatusSchema>;

export const workerExecutionSnapshotSchema = z
  .object({
    executionId: workerExecutionIdSchema,
    launchHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    status: workerExecutionStatusSchema,
    target: workerTargetSchema.optional(),
    exitCode: z.number().int().optional(),
    signal: z.string().max(64).optional(),
    cursor: z.number().int().nonnegative().safe(),
    totalBytes: z.number().int().nonnegative().safe(),
    startedAtMs: z.number().int().nonnegative().safe(),
    updatedAtMs: z.number().int().nonnegative().safe(),
    error: z.string().max(4_096).optional(),
  })
  .strict();
export type WorkerExecutionSnapshot = z.infer<
  typeof workerExecutionSnapshotSchema
>;

export const workerStartExecutionSchema = z
  .object({
    executionId: workerExecutionIdSchema,
    command: z.string().min(1).max(32_768),
    args: z.array(z.string().max(1_048_576)).max(4_096).default([]),
    cwd: z.string().min(1).max(32_768).optional(),
    env: z.record(z.string().max(32_768), z.string().max(1_048_576)).optional(),
    timeoutMs: z.number().int().positive().safe().optional(),
    terminationGraceMs: z
      .number()
      .int()
      .nonnegative()
      .max(30_000)
      .default(2_000),
    belowNormalPriority: z.boolean().default(true),
  })
  .strict();
export type WorkerStartExecution = z.infer<typeof workerStartExecutionSchema>;

export const workerOutputEventSchema = z
  .object({
    cursor: z.number().int().positive().safe(),
    kind: z.enum(["output", "terminal"]),
    stream: z.enum(["stdout", "stderr"]).optional(),
    dataBase64: z
      .string()
      .max(2 * 1024 * 1024)
      .optional(),
    status: workerExecutionStatusSchema.optional(),
    exitCode: z.number().int().optional(),
    signal: z.string().max(64).optional(),
  })
  .strict();
export type WorkerOutputEvent = z.infer<typeof workerOutputEventSchema>;

export const workerReadResultSchema = z
  .object({
    events: z.array(workerOutputEventSchema).max(256),
    snapshot: workerExecutionSnapshotSchema,
  })
  .strict();
export type WorkerReadResult = z.infer<typeof workerReadResultSchema>;

export const workerHealthSchema = z
  .object({
    protocolVersion: z.literal(EXECUTION_WORKER_PROTOCOL_VERSION),
    pid: z.number().int().positive().safe(),
    capabilities: z.array(z.string().min(1).max(128)).max(128),
    activeExecutions: z.number().int().nonnegative().safe(),
  })
  .strict();
export type WorkerHealth = z.infer<typeof workerHealthSchema>;

export const workerMetadataSchema = z
  .object({
    protocolVersion: z.literal(EXECUTION_WORKER_PROTOCOL_VERSION),
    pid: z.number().int().positive().safe(),
    host: z.literal("127.0.0.1"),
    port: z.number().int().min(1).max(65_535),
    startedAtMs: z.number().int().nonnegative().safe(),
  })
  .strict();
export type WorkerMetadata = z.infer<typeof workerMetadataSchema>;

export const workerTerminationResultSchema = z
  .object({
    attempted: z.boolean(),
    terminated: z.boolean(),
    method: z.string().min(1).max(64),
    error: z.string().max(4_096).nullable().optional(),
  })
  .strict();
export type WorkerTerminationResult = z.infer<
  typeof workerTerminationResultSchema
>;

export const workerRequestSchema = z
  .object({
    version: z.literal(EXECUTION_WORKER_PROTOCOL_VERSION),
    token: z.string().min(32).max(512),
    id: z.string().min(1).max(256),
    method: z.enum([
      "worker.health",
      "execution.start",
      "execution.get",
      "execution.list",
      "execution.read",
      "execution.cancel",
      "execution.remove",
    ]),
    params: z.unknown().default({}),
  })
  .strict();
export type WorkerRequest = z.infer<typeof workerRequestSchema>;

export const workerResponseSchema = z
  .object({
    version: z.literal(EXECUTION_WORKER_PROTOCOL_VERSION),
    id: z.string().min(1).max(256),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(4_096),
      })
      .strict()
      .optional(),
  })
  .strict();
export type WorkerResponse = z.infer<typeof workerResponseSchema>;
