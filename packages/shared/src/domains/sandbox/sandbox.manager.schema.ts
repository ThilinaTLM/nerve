import { z } from "zod";
import { isoDateTimeSchema } from "./sandbox.common.schema.js";

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
