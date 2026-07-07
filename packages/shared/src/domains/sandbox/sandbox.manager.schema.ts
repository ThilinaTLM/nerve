import { z } from "zod";
import {
  isoDateTimeSchema,
  redactedErrorSchema,
} from "./sandbox.common.schema.js";
import {
  sandboxConfigV1BaseSchema,
  sandboxControllerConfigSchema,
} from "./sandbox.config.schema.js";

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

export const sandboxActivityRunStatusSchema = z.enum([
  "idle",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
export type SandboxActivityRunStatus = z.infer<
  typeof sandboxActivityRunStatusSchema
>;

/**
 * Compact, best-effort per-sandbox agent activity the manager derives from
 * ingested controller events. Rebuildable and non-authoritative; used to make
 * the fleet view feel live without opening a sandbox. Emitted as the payload of
 * a `manager.sandbox.activity` event and embedded on fleet list items.
 */
export const sandboxActivitySummarySchema = z.object({
  sandboxId: z.string().min(1),
  runStatus: sandboxActivityRunStatusSchema,
  /** Short current-task / latest-activity line (path-safe, no secrets). */
  title: z.string().min(1).optional(),
  /** True while blocked on user input or an approval. */
  needsAttention: z.boolean().optional(),
  /** Model id currently in use (Phase B). */
  model: z.string().min(1).optional(),
  /** Provider currently in use (Phase B). */
  provider: z.string().min(1).optional(),
  /** Context-window usage percentage 0-100 (Phase B). */
  contextUsagePct: z.number().min(0).max(100).optional(),
  updatedAt: isoDateTimeSchema,
});
export type SandboxActivitySummary = z.infer<
  typeof sandboxActivitySummarySchema
>;

/** Fleet list item: a managed record plus its optional activity summary. */
export const managedSandboxListItemSchema = managedSandboxRecordSchema.extend({
  activity: sandboxActivitySummarySchema.optional(),
});
export type ManagedSandboxListItem = z.infer<
  typeof managedSandboxListItemSchema
>;

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

export const sandboxManagerLifecycleEventTypeSchema = z.enum([
  "manager.sandbox.created",
  "manager.sandbox.deleted",
  "manager.sandbox.start_requested",
  "manager.sandbox.started",
  "manager.sandbox.start_failed",
  "manager.sandbox.stop_requested",
  "manager.sandbox.stopped",
  "manager.sandbox.removed",
]);
export type SandboxManagerLifecycleEventType = z.infer<
  typeof sandboxManagerLifecycleEventTypeSchema
>;

/**
 * UI-consumed event envelope streamed over the manager UI WebSocket. Reducers
 * remain tolerant of future/unknown `type` values, so `data` stays `unknown`.
 */
export const sandboxManagerEventEnvelopeSchema = z
  .object({
    stream: z.string().min(1),
    sandboxId: z.string().min(1).optional(),
    seq: z.number().int().nonnegative().safe(),
    id: z.string().min(1).optional(),
    ts: isoDateTimeSchema,
    type: z.string().min(1),
    durability: z.enum(["durable", "transient"]).optional(),
    data: z.unknown().optional(),
  })
  .passthrough();
export type SandboxManagerEventEnvelope = z.infer<
  typeof sandboxManagerEventEnvelopeSchema
>;

/**
 * UI-friendly sandbox create config input. The manager owns and materializes
 * the controller wiring (URL/auth), so the UI may omit `controller` entirely.
 * The full `SandboxConfigV1` path (with `controller`) remains valid.
 */
export const sandboxCreateConfigInputSchema = sandboxConfigV1BaseSchema
  .omit({ controller: true })
  .extend({ controller: sandboxControllerConfigSchema.optional() });
export type SandboxCreateConfigInput = z.infer<
  typeof sandboxCreateConfigInputSchema
>;

export const sandboxCreateAuthRefsSchema = z.object({
  mainModelProfileId: z.string().min(1).optional(),
  exploreModelProfileId: z.string().min(1).optional(),
  githubProfileId: z.string().min(1).optional(),
  jiraProfileId: z.string().min(1).optional(),
  confluenceProfileId: z.string().min(1).optional(),
  webProfileId: z.string().min(1).optional(),
});
export type SandboxCreateAuthRefs = z.infer<typeof sandboxCreateAuthRefsSchema>;

export const sandboxCreateRequestSchema = z.object({
  config: sandboxCreateConfigInputSchema,
  image: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  start: z.boolean().optional(),
  auth: sandboxCreateAuthRefsSchema.optional(),
});
export type SandboxCreateRequest = z.infer<typeof sandboxCreateRequestSchema>;

export const sandboxManagerCredentialProfileKindSchema = z.enum([
  "model_provider",
  "github",
  "jira",
  "confluence",
  "web_provider",
]);
export type SandboxManagerCredentialProfileKind = z.infer<
  typeof sandboxManagerCredentialProfileKindSchema
>;

export const sandboxManagerCredentialProviderKindSchema = z.enum([
  "amazon_bedrock_api_key",
  "ant_ling_api_key",
  "anthropic_api_key",
  "anthropic_oauth",
  "azure_openai_responses_api_key",
  "cerebras_api_key",
  "cloudflare_ai_gateway_api_key",
  "cloudflare_workers_ai_api_key",
  "deepseek_api_key",
  "fireworks_api_key",
  "github_copilot_oauth",
  "google_api_key",
  "google_vertex_api_key",
  "groq_api_key",
  "huggingface_api_key",
  "kimi_coding_api_key",
  "minimax_api_key",
  "minimax_cn_api_key",
  "mistral_api_key",
  "moonshotai_api_key",
  "moonshotai_cn_api_key",
  "nvidia_api_key",
  "openai_api_key",
  "openai_codex_oauth",
  "opencode_api_key",
  "opencode_go_api_key",
  "openrouter_api_key",
  "together_api_key",
  "vercel_ai_gateway_api_key",
  "xai_api_key",
  "xiaomi_api_key",
  "xiaomi_token_plan_ams_api_key",
  "xiaomi_token_plan_cn_api_key",
  "xiaomi_token_plan_sgp_api_key",
  "zai_api_key",
  "zai_coding_cn_api_key",
  "custom_api_key",
  "custom_bearer",
  "github_pat",
  "github_oauth",
  "github_app",
  "github_ssh",
  "jira_api_token",
  "jira_oauth",
  "confluence_api_token",
  "confluence_oauth",
  "tavily_api_key",
]);
export type SandboxManagerCredentialProviderKind = z.infer<
  typeof sandboxManagerCredentialProviderKindSchema
>;

export const sandboxManagerCredentialAuthTypeSchema = z.enum([
  "api_key",
  "bearer",
  "basic",
  "oauth",
  "ssh",
  "github_app",
]);
export type SandboxManagerCredentialAuthType = z.infer<
  typeof sandboxManagerCredentialAuthTypeSchema
>;

export const sandboxManagerCredentialStatusSchema = z.enum([
  "configured",
  "needs_login",
  "refreshing",
  "expired",
  "invalid",
  "revoked",
]);
export type SandboxManagerCredentialStatus = z.infer<
  typeof sandboxManagerCredentialStatusSchema
>;

export const sandboxManagerCredentialSecretRefSchema = z.object({
  purpose: z.string().min(1),
  configured: z.boolean(),
  expiresAt: isoDateTimeSchema.optional(),
});
export type SandboxManagerCredentialSecretRef = z.infer<
  typeof sandboxManagerCredentialSecretRefSchema
>;

export const sandboxManagerCredentialProfileSchema = z.object({
  profileId: z.string().min(1),
  kind: sandboxManagerCredentialProfileKindSchema,
  providerKind: sandboxManagerCredentialProviderKindSchema,
  displayName: z.string().min(1),
  provider: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  siteUrl: z.string().url().optional(),
  email: z.string().email().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  compat: z.record(z.string(), z.unknown()).optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  authType: sandboxManagerCredentialAuthTypeSchema,
  status: sandboxManagerCredentialStatusSchema,
  expiresAt: isoDateTimeSchema.optional(),
  refreshAfter: isoDateTimeSchema.optional(),
  lastValidatedAt: isoDateTimeSchema.optional(),
  lastRefreshAt: isoDateTimeSchema.optional(),
  lastError: redactedErrorSchema.optional(),
  secretRefs: z.array(sandboxManagerCredentialSecretRefSchema).default([]),
  credential: z.unknown().optional(),
  defaultModel: z.string().min(1).optional(),
  defaultOwner: z.string().min(1).optional(),
  defaultRepo: z.string().min(1).optional(),
  defaultProjectKey: z.string().min(1).optional(),
  defaultSpaceKey: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type SandboxManagerCredentialProfile = z.infer<
  typeof sandboxManagerCredentialProfileSchema
>;

export const sandboxManagerOAuthImportSchema = z.object({
  accessToken: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  expiresAt: isoDateTimeSchema.optional(),
  rawBundle: z.unknown().optional(),
});
export type SandboxManagerOAuthImport = z.infer<
  typeof sandboxManagerOAuthImportSchema
>;

export const sandboxManagerCredentialProfileWriteSchema = z.object({
  profileId: z.string().min(1).optional(),
  kind: sandboxManagerCredentialProfileKindSchema,
  providerKind: sandboxManagerCredentialProviderKindSchema,
  displayName: z.string().min(1),
  provider: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  siteUrl: z.string().url().optional(),
  email: z.string().email().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  compat: z.record(z.string(), z.unknown()).optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  defaultModel: z.string().min(1).optional(),
  defaultOwner: z.string().min(1).optional(),
  defaultRepo: z.string().min(1).optional(),
  defaultProjectKey: z.string().min(1).optional(),
  defaultSpaceKey: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  bearerToken: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  privateKey: z.string().min(1).optional(),
  passphrase: z.string().min(1).optional(),
  githubApp: z
    .object({
      appId: z.string().min(1),
      installationId: z.string().min(1),
      privateKey: z.string().min(1),
    })
    .optional(),
  oauthImport: sandboxManagerOAuthImportSchema.optional(),
  credential: z.unknown().optional(),
});
export type SandboxManagerCredentialProfileWrite = z.infer<
  typeof sandboxManagerCredentialProfileWriteSchema
>;

export const managerCredentialResolveRequestSchema = z.object({
  profileId: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
  purpose: z
    .enum(["model_api", "github", "jira", "confluence", "web"])
    .optional(),
  minTtlMs: z.number().int().nonnegative().safe().optional(),
});
export type ManagerCredentialResolveRequest = z.infer<
  typeof managerCredentialResolveRequestSchema
>;

export const managerCredentialResolveResponseSchema = z.object({
  value: z.string().min(1),
  credentialType: z.enum([
    "api_key",
    "bearer",
    "basic_password",
    "ssh_private_key",
  ]),
  expiresAt: isoDateTimeSchema.optional(),
  refreshAfter: isoDateTimeSchema.optional(),
  cacheTtlMs: z.number().int().nonnegative().safe().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});
export type ManagerCredentialResolveResponse = z.infer<
  typeof managerCredentialResolveResponseSchema
>;

export const sandboxManagerSecretMetadataSchema = z.object({
  key: z.string().min(1),
  version: z.string().min(1).optional(),
  expiresAt: isoDateTimeSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
  cleartextWarning: z.string().min(1).optional(),
});
export type SandboxManagerSecretMetadata = z.infer<
  typeof sandboxManagerSecretMetadataSchema
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
