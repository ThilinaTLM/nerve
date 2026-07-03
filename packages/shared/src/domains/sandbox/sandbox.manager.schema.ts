import { z } from "zod";
import {
  isoDateTimeSchema,
  redactedErrorSchema,
} from "./sandbox.common.schema.js";

export const managedSandboxObservedStateSchema = z.enum([
  "unknown",
  "creating",
  "starting",
  "running",
  "reconnecting",
  "exited",
  "failed",
  "stopping",
  "removed",
]);
export type ManagedSandboxObservedState = z.infer<
  typeof managedSandboxObservedStateSchema
>;

export const managedSandboxDesiredStateSchema = z.enum([
  "created",
  "running",
  "stopped",
  "removed",
]);
export type ManagedSandboxDesiredState = z.infer<
  typeof managedSandboxDesiredStateSchema
>;

export const volumeRefSchema = z.object({
  kind: z.string().min(1),
  name: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  target: z.string().min(1),
  readonly: z.boolean().optional(),
});
export type VolumeRef = z.infer<typeof volumeRefSchema>;

export const managedSandboxRetentionSchema = z.object({
  removeContainerAfterMs: z.number().int().nonnegative().safe().optional(),
  removeWorkspaceAfterMs: z.number().int().nonnegative().safe().optional(),
  removeStateAfterMs: z.number().int().nonnegative().safe().optional(),
  preserveFailed: z.boolean().optional(),
});
export type ManagedSandboxRetention = z.infer<
  typeof managedSandboxRetentionSchema
>;

export const managedContainerRefSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type ManagedContainerRef = z.infer<typeof managedContainerRefSchema>;

export const managedSandboxRecordSchema = z.object({
  sandboxId: z.string().min(1),
  instanceId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  backend: z.string().min(1),
  image: z.object({
    reference: z.string().min(1),
    digest: z.string().min(1).optional(),
    sandboxSpec: z.literal("v1").optional(),
    runtimeVersion: z.string().min(1).optional(),
  }),
  desiredState: managedSandboxDesiredStateSchema,
  observedState: managedSandboxObservedStateSchema,
  configDigest: z.string().min(1).optional(),
  workspaceRef: volumeRefSchema,
  stateRef: volumeRefSchema,
  secretMountRefs: z.array(volumeRefSchema).optional(),
  configRef: volumeRefSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.optional(),
  stoppedAt: isoDateTimeSchema.optional(),
  gcAfter: isoDateTimeSchema.optional(),
  retention: managedSandboxRetentionSchema.optional(),
  controller: z
    .object({
      token: z.string().min(1),
      url: z.string().min(1).optional(),
      sessionId: z.string().min(1).optional(),
    })
    .optional(),
  containerRef: managedContainerRefSchema.optional(),
  lastError: z
    .object({ code: z.string().min(1), message: z.string().min(1) })
    .optional(),
});
export type ManagedSandboxRecord = z.infer<typeof managedSandboxRecordSchema>;

export const managerOutboundCommandRecordSchema = z.object({
  requestId: z.string().min(1),
  sandboxId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  method: z.string().min(1),
  paramsHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  paramsSummary: z.unknown().optional(),
  status: z.enum([
    "queued",
    "sent",
    "completed",
    "failed",
    "timed_out",
    "cancelled",
  ]),
  createdAt: isoDateTimeSchema,
  sentAt: isoDateTimeSchema.optional(),
  timeoutAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  resultRef: z.string().min(1).optional(),
  error: redactedErrorSchema.optional(),
});
export type ManagerOutboundCommandRecord = z.infer<
  typeof managerOutboundCommandRecordSchema
>;

export const managerLifecycleRequestRecordSchema = z.object({
  requestId: z.string().min(1),
  sandboxId: z.string().min(1).optional(),
  route: z.string().min(1),
  method: z.string().min(1),
  actor: z.string().min(1).optional(),
  paramsHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  status: z.enum(["accepted", "running", "completed", "failed", "conflict"]),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.optional(),
  resultRef: z.string().min(1).optional(),
  error: redactedErrorSchema.optional(),
});
export type ManagerLifecycleRequestRecord = z.infer<
  typeof managerLifecycleRequestRecordSchema
>;

export const runtimeNetworkSpecSchema = z.object({
  mode: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  ports: z
    .array(
      z.object({
        containerPort: z.number().int().positive().safe(),
        hostPort: z.number().int().positive().safe().optional(),
        protocol: z.enum(["tcp", "udp"]).optional(),
      }),
    )
    .optional(),
  egressPolicyRef: z.string().min(1).optional(),
});
export type RuntimeNetworkSpec = z.infer<typeof runtimeNetworkSpecSchema>;

export const runtimeSecuritySpecSchema = z.object({
  readOnlyRootFilesystem: z.boolean().optional(),
  user: z.string().min(1).optional(),
  privileged: z.boolean().optional(),
  capDrop: z.array(z.string().min(1)).optional(),
  capAdd: z.array(z.string().min(1)).optional(),
  noNewPrivileges: z.boolean().optional(),
  pidsLimit: z.number().int().positive().safe().optional(),
  prohibitedMountChecks: z.boolean().optional(),
});
export type RuntimeSecuritySpec = z.infer<typeof runtimeSecuritySpecSchema>;

export const runtimeResourceSpecSchema = z.object({
  cpu: z.string().min(1).optional(),
  memoryMb: z.number().int().positive().safe().optional(),
  diskMb: z.number().int().positive().safe().optional(),
  maxOpenFiles: z.number().int().positive().safe().optional(),
});
export type RuntimeResourceSpec = z.infer<typeof runtimeResourceSpecSchema>;

export const runtimeHealthcheckSpecSchema = z.object({
  command: z.array(z.string().min(1)),
  intervalMs: z.number().int().positive().safe().optional(),
  timeoutMs: z.number().int().positive().safe().optional(),
  retries: z.number().int().nonnegative().safe().optional(),
  startPeriodMs: z.number().int().nonnegative().safe().optional(),
});
export type RuntimeHealthcheckSpec = z.infer<
  typeof runtimeHealthcheckSpecSchema
>;

export const managedContainerCreateSpecSchema = z.object({
  sandboxId: z.string().min(1),
  instanceId: z.string().min(1),
  image: z.string().min(1),
  command: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()),
  labels: z.record(z.string(), z.string()),
  mounts: z.array(volumeRefSchema),
  workingDir: z.string().min(1).optional(),
  user: z.string().min(1).optional(),
  network: runtimeNetworkSpecSchema.optional(),
  security: runtimeSecuritySpecSchema.optional(),
  resources: runtimeResourceSpecSchema.optional(),
  healthcheck: runtimeHealthcheckSpecSchema.optional(),
});
export type ManagedContainerCreateSpec = z.infer<
  typeof managedContainerCreateSpecSchema
>;

export const managedContainerStatusSchema = z.object({
  ref: managedContainerRefSchema,
  state: managedSandboxObservedStateSchema,
  exitCode: z.number().int().safe().optional(),
  startedAt: isoDateTimeSchema.optional(),
  finishedAt: isoDateTimeSchema.optional(),
  health: z.enum(["starting", "healthy", "unhealthy", "unknown"]).optional(),
  limitations: z.array(z.string().min(1)).optional(),
});
export type ManagedContainerStatus = z.infer<
  typeof managedContainerStatusSchema
>;

export const runtimeDriverCapabilitiesSchema = z.object({
  kind: z.string().min(1),
  available: z.boolean(),
  version: z.string().min(1).optional(),
  rootless: z.boolean().optional(),
  supportsReadOnlyRootFilesystem: z.boolean(),
  supportsNoNewPrivileges: z.boolean(),
  supportsPidsLimit: z.boolean(),
  supportsCpuLimit: z.boolean(),
  supportsMemoryLimit: z.boolean(),
  supportsTmpfs: z.boolean(),
  limitations: z.array(z.string().min(1)),
});
export type RuntimeDriverCapabilities = z.infer<
  typeof runtimeDriverCapabilitiesSchema
>;

export const sandboxManagerLifecycleSettingsSchema = z.object({
  reconcileOnStartup: z.boolean(),
  reconcileIntervalMs: z.number().int().nonnegative().safe().optional(),
  gcIntervalMs: z.number().int().nonnegative().safe().optional(),
  orphanPolicy: z.string().min(1),
  heartbeatTimeoutMs: z.number().int().positive().safe(),
  maxPendingCommands: z.number().int().nonnegative().safe(),
  maxCommandBytes: z.number().int().positive().safe(),
});
export type SandboxManagerLifecycleSettings = z.infer<
  typeof sandboxManagerLifecycleSettingsSchema
>;

export const sandboxManagerHardeningStatusSchema = z.object({
  mode: z.enum(["production", "development"]),
  apiAuth: z.enum(["configured", "disabled"]),
  secretStorage: z.object({
    encryptionAtRest: z.enum([
      "enabled",
      "development_cleartext",
      "unavailable",
      "unknown",
    ]),
    keyId: z.string().min(1).optional(),
    warning: z.string().min(1).optional(),
  }),
});
export type SandboxManagerHardeningStatus = z.infer<
  typeof sandboxManagerHardeningStatusSchema
>;

export const sandboxManagerStatusSchema = z.object({
  managerId: z.string().min(1),
  version: z.string().min(1),
  backend: z.string().min(1),
  runtime: runtimeDriverCapabilitiesSchema,
  hardening: sandboxManagerHardeningStatusSchema,
  lifecycle: sandboxManagerLifecycleSettingsSchema,
  updatedAt: isoDateTimeSchema,
});
export type SandboxManagerStatus = z.infer<typeof sandboxManagerStatusSchema>;

export const logReadOptionsSchema = z.object({
  since: isoDateTimeSchema.optional(),
  tail: z.number().int().nonnegative().safe().optional(),
});
export type LogReadOptions = z.infer<typeof logReadOptionsSchema>;

export const stopOptionsSchema = z.object({
  timeoutMs: z.number().int().nonnegative().safe().optional(),
});
export type StopOptions = z.infer<typeof stopOptionsSchema>;

export const removeOptionsSchema = z.object({
  force: z.boolean().optional(),
  removeVolumes: z.boolean().optional(),
});
export type RemoveOptions = z.infer<typeof removeOptionsSchema>;
