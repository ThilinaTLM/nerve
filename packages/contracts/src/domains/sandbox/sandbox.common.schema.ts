import { z } from "zod";

export const sandboxIdSchema = z.string().min(1);
export const sandboxInstanceIdSchema = z.string().min(1);
export const sandboxConversationIdSchema = z.string().min(1);
export const sandboxAgentIdSchema = z.string().min(1);
export const sandboxRunIdSchema = z.string().min(1);
export const isoDateTimeSchema = z.string().datetime();

export const sandboxRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "completed",
  "failed",
  "recoverable_failed",
  "cancelled",
]);
export type SandboxRunStatus = z.infer<typeof sandboxRunStatusSchema>;

export const sandboxDaemonStatusSchema = z.enum([
  "booting",
  "ready",
  "running",
  "degraded",
  "recovering",
  "reconnecting",
  "stopping",
  "failed",
  "offline",
]);
export type SandboxDaemonStatus = z.infer<typeof sandboxDaemonStatusSchema>;

export const sandboxStartupStageSchema = z.enum([
  "config",
  "state",
  "controller",
  "preflight",
  "models",
  "secrets",
  "git",
  "github",
  "context",
  "skills",
  "boot",
  "runtime",
  "ready",
]);
export type SandboxStartupStage = z.infer<typeof sandboxStartupStageSchema>;

export const sandboxCredentialTypeSchema = z.enum([
  "none",
  "api_key",
  "bearer",
  "oauth",
  "ssh",
  "gpg",
  "basic",
]);
export type SandboxCredentialType = z.infer<typeof sandboxCredentialTypeSchema>;

export const redactedErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
});
export type RedactedError = z.infer<typeof redactedErrorSchema>;

export const boundedTextSchema = z.object({
  text: z.string(),
  truncated: z.boolean().optional(),
  bytes: z.number().int().nonnegative().safe().optional(),
});
export type BoundedText = z.infer<typeof boundedTextSchema>;

export const artifactRefSchema = z.object({
  path: z.string().min(1).optional(),
  contentId: z.string().min(1).optional(),
  url: z.string().url().optional(),
  mimeType: z.string().min(1).optional(),
  bytes: z.number().int().nonnegative().safe().optional(),
  expiresAt: isoDateTimeSchema.optional(),
});
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const degradedStatusSchema = z.object({
  degraded: z.literal(true),
  reason: z.string().min(1),
  since: isoDateTimeSchema,
  limitations: z.array(z.string().min(1)),
});
export type DegradedStatus = z.infer<typeof degradedStatusSchema>;

export const controllerConnectivityStatusSchema = z.object({
  state: z.enum([
    "connecting",
    "connected",
    "reconnecting",
    "disconnected",
    "shutting_down",
  ]),
  sessionId: z.string().min(1).optional(),
  acceptedCapabilities: z.array(z.string().min(1)).optional(),
  connectedAt: isoDateTimeSchema.optional(),
  disconnectedAt: isoDateTimeSchema.optional(),
  closeCode: z.number().int().safe().optional(),
  closeReason: z.string().min(1).optional(),
  lastHeartbeatAt: isoDateTimeSchema.optional(),
  lastErrorCode: z.string().min(1).optional(),
  lastError: redactedErrorSchema.optional(),
  reconnectAttempts: z.number().int().nonnegative().safe().optional(),
  outboundQueue: z
    .object({
      pendingBatches: z.number().int().nonnegative().safe().optional(),
      pendingEvents: z.number().int().nonnegative().safe().optional(),
      pendingBytes: z.number().int().nonnegative().safe().optional(),
      maxEvents: z.number().int().nonnegative().safe().optional(),
      maxBytes: z.number().int().nonnegative().safe().optional(),
      overflowedAt: isoDateTimeSchema.optional(),
    })
    .optional(),
  exitAfterMs: z.number().int().nonnegative().safe().optional(),
  exitAt: isoDateTimeSchema.optional(),
});
export type ControllerConnectivityStatus = z.infer<
  typeof controllerConnectivityStatusSchema
>;

export const startupSetupStatusSchema = z.object({
  configured: z.boolean(),
  status: z.enum(["skipped", "started", "completed", "failed", "degraded"]),
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  limitations: z.array(z.string().min(1)).optional(),
  error: redactedErrorSchema.optional(),
});
export type StartupSetupStatus = z.infer<typeof startupSetupStatusSchema>;

export const toolGroupStatusSchema = z.object({
  group: z.string().min(1),
  configured: z.boolean(),
  active: z.boolean(),
  tools: z.array(z.string().min(1)),
  unavailableTools: z.array(z.string().min(1)).optional(),
  credentialType: sandboxCredentialTypeSchema.optional(),
  limitations: z.array(z.string().min(1)).optional(),
});
export type ToolGroupStatus = z.infer<typeof toolGroupStatusSchema>;

export const secretStoreStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["available", "unavailable", "degraded", "skipped"]),
  cacheEnabled: z.boolean().optional(),
  limitations: z.array(z.string().min(1)).optional(),
});
export type SecretStoreStatus = z.infer<typeof secretStoreStatusSchema>;

export const contextFileStatusSchema = z.object({
  path: z.string().min(1),
  digest: z.string().min(1).optional(),
  bytes: z.number().int().nonnegative().safe().optional(),
  included: z.boolean(),
});
export type ContextFileStatus = z.infer<typeof contextFileStatusSchema>;

export const skillStatusSchema = z.object({
  name: z.string().min(1),
  source: z.enum(["builtin", "workspace", "manager", "mounted", "unknown"]),
  path: z.string().min(1),
  digest: z.string().min(1).optional(),
  modelVisible: z.boolean(),
  bytes: z.number().int().nonnegative().safe().optional(),
});
export type SkillStatus = z.infer<typeof skillStatusSchema>;

export const networkPolicyStatusSchema = z.object({
  requestedDefault: z.enum(["allow", "deny"]),
  enforcedDefault: z.enum(["allow", "deny", "unknown"]),
  allowedHosts: z.array(z.string().min(1)),
  deniedHosts: z.array(z.string().min(1)),
  packageRegistryHosts: z.array(z.string().min(1)).optional(),
  backend: z.enum([
    "container",
    "iptables",
    "nftables",
    "proxy",
    "cni",
    "none",
  ]),
  limitations: z.array(z.string().min(1)).optional(),
});
export type NetworkPolicyStatus = z.infer<typeof networkPolicyStatusSchema>;

export const sandboxEventCommonSchema = z.object({
  sandboxId: sandboxIdSchema.optional(),
  instanceId: sandboxInstanceIdSchema.optional(),
  configDigest: z.string().min(1).optional(),
});
export type SandboxEventCommon = z.infer<typeof sandboxEventCommonSchema>;

export const sandboxRunScopeSchema = z.object({
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
});
export type SandboxRunScope = z.infer<typeof sandboxRunScopeSchema>;
