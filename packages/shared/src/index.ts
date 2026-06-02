import { z } from "zod";

export const modeSchema = z.enum(["planning", "coding"]);
export type Mode = z.infer<typeof modeSchema>;

export const permissionLevelSchema = z.enum([
  "autonomous",
  "supervised",
  "read_only",
]);
export type PermissionLevel = z.infer<typeof permissionLevelSchema>;

export const toolRiskSchema = z.enum([
  "read",
  "plan_write",
  "workspace_write",
  "command",
  "network",
  "secret",
  "destructive",
  "agent_spawn",
  "deployment",
]);
export type ToolRisk = z.infer<typeof toolRiskSchema>;

export const eventEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  id: z.string().startsWith("evt_"),
  ts: z.string().datetime(),
  type: z.string().min(1),
  data: z.unknown(),
});
export type EventEnvelope<T = unknown> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  "data"
> & {
  data: T;
};

export const settingsSchema = z.object({
  defaultMode: modeSchema,
  defaultPermissionLevel: permissionLevelSchema,
  defaultSubagentMode: modeSchema,
  defaultSubagentPermissionLevel: permissionLevelSchema,
  server: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(3747),
    allowRemote: z.boolean().default(false),
  }),
  ui: z.object({
    theme: z.enum(["system", "light", "dark"]),
  }),
  compaction: z.object({
    auto: z.boolean(),
    thresholdTokens: z.number().int().positive(),
    keepRecentTokens: z.number().int().positive(),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  defaultMode: "coding",
  defaultPermissionLevel: "supervised",
  defaultSubagentMode: "planning",
  defaultSubagentPermissionLevel: "read_only",
  server: {
    host: "127.0.0.1",
    port: 3747,
    allowRemote: false,
  },
  ui: {
    theme: "system",
  },
  compaction: {
    auto: false,
    thresholdTokens: 80_000,
    keepRecentTokens: 20_000,
  },
};

export const statusResponseSchema = z.object({
  daemonId: z.string().startsWith("daemon_"),
  version: z.string(),
  startedAt: z.string().datetime(),
  dataDir: z.string(),
  storage: z.object({
    home: z.string(),
    sqlitePath: z.string(),
    indexHealthy: z.boolean(),
  }),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const daemonFileSchema = z.object({
  daemonId: z.string().startsWith("daemon_"),
  pid: z.number().int().positive(),
  host: z.string(),
  port: z.number().int().positive(),
  url: z.string().url(),
  startedAt: z.string().datetime(),
  dataDir: z.string(),
  version: z.string(),
});
export type DaemonFile = z.infer<typeof daemonFileSchema>;

export const storageInfoSchema = z.object({
  dataDir: z.string(),
  sqlitePath: z.string(),
  configPath: z.string(),
  counts: z
    .object({
      projects: z.number().int().nonnegative(),
      sessions: z.number().int().nonnegative(),
      agents: z.number().int().nonnegative(),
      events: z.number().int().nonnegative(),
      processes: z.number().int().nonnegative(),
      workers: z.number().int().nonnegative(),
    })
    .optional(),
});
export type StorageInfo = z.infer<typeof storageInfoSchema>;

export const workerKindSchema = z.enum(["local"]);
export type WorkerKind = z.infer<typeof workerKindSchema>;

export const workerStatusSchema = z.enum(["online", "offline", "error"]);
export type WorkerStatus = z.infer<typeof workerStatusSchema>;

export const workerRecordSchema = z.object({
  id: z.string().startsWith("worker_"),
  kind: workerKindSchema,
  name: z.string().min(1),
  status: workerStatusSchema,
  capabilities: z
    .array(z.enum(["agent", "process"]))
    .default(["agent", "process"]),
  endpoint: z
    .object({
      pid: z.number().int().positive().optional(),
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
    })
    .optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkerRecord = z.infer<typeof workerRecordSchema>;

export const workspaceScopeSchema = z.object({
  roots: z.array(z.string()).min(1),
  readonly: z.boolean().optional(),
});
export type WorkspaceScope = z.infer<typeof workspaceScopeSchema>;

export const modelSelectionSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const updateSettingsRequestSchema = z.object({
  defaultMode: modeSchema.optional(),
  defaultPermissionLevel: permissionLevelSchema.optional(),
  defaultSubagentMode: modeSchema.optional(),
  defaultSubagentPermissionLevel: permissionLevelSchema.optional(),
  server: z
    .object({
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
      allowRemote: z.boolean().optional(),
    })
    .optional(),
  ui: z
    .object({
      theme: z.enum(["system", "light", "dark"]).optional(),
    })
    .optional(),
  compaction: z
    .object({
      auto: z.boolean().optional(),
      thresholdTokens: z.number().int().positive().optional(),
      keepRecentTokens: z.number().int().positive().optional(),
    })
    .optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

export const updateAgentRequestSchema = z.object({
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
  model: modelSelectionSchema.nullable().optional(),
});
export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;

export const credentialTypeSchema = z.enum(["api_key", "oauth"]);
export type CredentialType = z.infer<typeof credentialTypeSchema>;

export const providerApiKeySchema = z.object({
  provider: z.string().min(1),
  envVar: z.string().min(1),
  configured: z.boolean(),
});
export type ProviderApiKey = z.infer<typeof providerApiKeySchema>;

export const authProviderMetadataSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  supportsApiKey: z.boolean(),
  supportsOAuth: z.boolean(),
  oauthName: z.string().optional(),
  configured: z.boolean(),
  credentialType: credentialTypeSchema.optional(),
  envVar: z.string().optional(),
  warning: z.string().optional(),
});
export type AuthProviderMetadata = z.infer<typeof authProviderMetadataSchema>;

export const setProviderApiKeyRequestSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1),
});
export type SetProviderApiKeyRequest = z.infer<
  typeof setProviderApiKeyRequestSchema
>;

export const startOAuthFlowRequestSchema = z.object({
  provider: z.string().min(1),
});
export type StartOAuthFlowRequest = z.infer<typeof startOAuthFlowRequestSchema>;

export const oauthFlowStatusSchema = z.enum([
  "starting",
  "select",
  "auth_url",
  "device_code",
  "prompt",
  "progress",
  "succeeded",
  "failed",
  "cancelled",
]);
export type OAuthFlowStatus = z.infer<typeof oauthFlowStatusSchema>;

export const oauthFlowInfoSchema = z.object({
  flowId: z.string().startsWith("authflow_"),
  provider: z.string().min(1),
  providerName: z.string().min(1),
  status: oauthFlowStatusSchema,
  promptId: z.string().optional(),
  message: z.string().optional(),
  authUrl: z.string().optional(),
  instructions: z.string().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  deviceCode: z
    .object({
      userCode: z.string(),
      verificationUri: z.string(),
      intervalSeconds: z.number().optional(),
      expiresInSeconds: z.number().optional(),
    })
    .optional(),
  placeholder: z.string().optional(),
  allowEmpty: z.boolean().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OAuthFlowInfo = z.infer<typeof oauthFlowInfoSchema>;

export const respondOAuthFlowRequestSchema = z.object({
  promptId: z.string().min(1),
  value: z.string().optional(),
  selectedId: z.string().optional(),
});
export type RespondOAuthFlowRequest = z.infer<
  typeof respondOAuthFlowRequestSchema
>;

export const importSessionRequestSchema = z.object({
  project: z
    .object({
      name: z.string().min(1).optional(),
      dir: z.string().min(1),
    })
    .optional(),
  session: z.object({
    title: z.string().min(1).optional(),
    mode: modeSchema.optional(),
    permissionLevel: permissionLevelSchema.optional(),
  }),
  agents: z.array(z.unknown()).default([]),
  entries: z.array(z.unknown()).default([]),
});
export type ImportSessionRequest = z.infer<typeof importSessionRequestSchema>;

export const projectRecordSchema = z.object({
  id: z.string().startsWith("proj_"),
  name: z.string().min(1),
  dir: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const createProjectRequestSchema = z.object({
  dir: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const filesystemEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.literal("directory"),
  hidden: z.boolean(),
});
export type FilesystemEntry = z.infer<typeof filesystemEntrySchema>;

export const filesystemDirectoryResponseSchema = z.object({
  path: z.string().min(1),
  parent: z.string().min(1).optional(),
  entries: z.array(filesystemEntrySchema),
});
export type FilesystemDirectoryResponse = z.infer<
  typeof filesystemDirectoryResponseSchema
>;

export const filesystemDirectoryQuerySchema = z.object({
  path: z.string().optional(),
  showHidden: z.coerce.boolean().optional(),
});
export type FilesystemDirectoryQuery = z.infer<
  typeof filesystemDirectoryQuerySchema
>;

export const sessionRecordSchema = z.object({
  id: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  title: z.string().min(1),
  mode: modeSchema,
  permissionLevel: permissionLevelSchema,
  activeAgentId: z.string().startsWith("agent_").optional(),
  activeEntryId: z.string().startsWith("entry_").optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export const createSessionRequestSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  title: z.string().min(1).optional(),
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const agentStatusSchema = z.enum([
  "idle",
  "running",
  "aborted",
  "error",
]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentBudgetSchema = z.object({
  depth: z.number().int().nonnegative().default(0),
  maxDepth: z.number().int().positive().max(8).default(3),
  maxRuns: z.number().int().positive().max(64).default(8),
  usedRuns: z.number().int().nonnegative().default(0),
});
export type AgentBudget = z.infer<typeof agentBudgetSchema>;

export const createAgentBudgetRequestSchema = agentBudgetSchema.partial();
export type CreateAgentBudgetRequest = z.infer<
  typeof createAgentBudgetRequestSchema
>;

export const agentRecordSchema = z.object({
  id: z.string().startsWith("agent_"),
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  projectDir: z.string().min(1),
  workerId: z.string().startsWith("worker_").optional(),
  parentAgentId: z.string().startsWith("agent_").optional(),
  rootAgentId: z.string().startsWith("agent_"),
  mode: modeSchema,
  permissionLevel: permissionLevelSchema,
  workspaceScope: workspaceScopeSchema,
  budget: agentBudgetSchema.default({
    depth: 0,
    maxDepth: 3,
    maxRuns: 8,
    usedRuns: 0,
  }),
  model: modelSelectionSchema.optional(),
  status: agentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentRecord = z.infer<typeof agentRecordSchema>;

export const createAgentRequestSchema = z.object({
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  projectDir: z.string().min(1).optional(),
  workerId: z.string().startsWith("worker_").optional(),
  parentAgentId: z.string().startsWith("agent_").optional(),
  task: z.string().optional(),
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
  workspaceScope: workspaceScopeSchema.optional(),
  budget: createAgentBudgetRequestSchema.optional(),
  model: modelSelectionSchema.optional(),
});
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

export const promptRequestSchema = z.object({
  text: z.string().min(1),
  images: z
    .array(
      z.object({
        type: z.literal("image"),
        data: z.string(),
        mimeType: z.string(),
      }),
    )
    .optional(),
  behavior: z.enum(["reject-if-busy", "steer", "follow-up"]).optional(),
});
export type PromptRequest = z.infer<typeof promptRequestSchema>;

export const coreToolNameSchema = z.enum([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);
export type CoreToolName = z.infer<typeof coreToolNameSchema>;

export const orchestrationToolNameSchema = z.enum([
  "process_start",
  "process_stop",
  "process_restart",
  "process_list",
  "process_logs",
  "subagent_run",
]);
export type OrchestrationToolName = z.infer<
  typeof orchestrationToolNameSchema
>;

export const toolNameSchema = z.enum([
  ...coreToolNameSchema.options,
  ...orchestrationToolNameSchema.options,
]);
export type ToolName = z.infer<typeof toolNameSchema>;

export const toolDescriptorSchema = z.object({
  name: toolNameSchema,
  risk: toolRiskSchema,
  description: z.string(),
});
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;

export const toolCallStatusSchema = z.enum([
  "requested",
  "pending_approval",
  "running",
  "completed",
  "denied",
  "error",
]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const toolCallRecordSchema = z.object({
  id: z.string().startsWith("tool_"),
  agentId: z.string().startsWith("agent_"),
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  toolName: toolNameSchema,
  risk: toolRiskSchema,
  args: z.unknown(),
  cwd: z.string().min(1),
  status: toolCallStatusSchema,
  approvalId: z.string().startsWith("approval_").optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;

export const approvalStatusSchema = z.enum(["pending", "granted", "denied"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalRecordSchema = z.object({
  id: z.string().startsWith("approval_"),
  toolCallId: z.string().startsWith("tool_"),
  agentId: z.string().startsWith("agent_"),
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  risk: toolRiskSchema,
  reason: z.string(),
  status: approvalStatusSchema,
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
});
export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;

export const executeToolRequestSchema = z.object({
  toolName: toolNameSchema,
  args: z.record(z.string(), z.unknown()).default({}),
});
export type ExecuteToolRequest = z.infer<typeof executeToolRequestSchema>;

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

export const processRecordSchema = z.object({
  id: z.string().startsWith("proc_"),
  name: z.string().min(1).optional(),
  workerId: z.string().startsWith("worker_").optional(),
  projectId: z.string().startsWith("proj_").optional(),
  sessionId: z.string().startsWith("ses_").optional(),
  agentId: z.string().startsWith("agent_").optional(),
  cwd: z.string().min(1),
  command: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
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
});
export type ProcessRecord = z.infer<typeof processRecordSchema>;

export const startProcessRequestSchema = z.object({
  name: z.string().min(1).optional(),
  workerId: z.string().startsWith("worker_").optional(),
  projectId: z.string().startsWith("proj_").optional(),
  sessionId: z.string().startsWith("ses_").optional(),
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

export const resolveApprovalRequestSchema = z.object({
  note: z.string().optional(),
});
export type ResolveApprovalRequest = z.infer<
  typeof resolveApprovalRequestSchema
>;

export const sessionEntryKindSchema = z.enum([
  "message",
  "compaction",
  "branch_summary",
  "subagent_summary",
]);
export type SessionEntryKind = z.infer<typeof sessionEntryKindSchema>;

export const sessionEntrySchema = z.object({
  id: z.string().startsWith("entry_"),
  sessionId: z.string().startsWith("ses_"),
  agentId: z.string().startsWith("agent_").optional(),
  parentEntryId: z.string().startsWith("entry_").optional(),
  role: z.enum(["user", "assistant", "system"]),
  kind: sessionEntryKindSchema.default("message"),
  text: z.string(),
  summary: z.string().optional(),
  tokensBefore: z.number().int().nonnegative().optional(),
  firstKeptEntryId: z.string().startsWith("entry_").optional(),
  fromEntryId: z.string().startsWith("entry_").optional(),
  details: z.unknown().optional(),
  createdAt: z.string().datetime(),
});
export type SessionEntry = z.infer<typeof sessionEntrySchema>;

export const sessionTreeNodeSchema = z.object({
  entry: sessionEntrySchema,
  childEntryIds: z.array(z.string().startsWith("entry_")),
});
export type SessionTreeNode = z.infer<typeof sessionTreeNodeSchema>;

export const sessionTreeSchema = z.object({
  sessionId: z.string().startsWith("ses_"),
  activeEntryId: z.string().startsWith("entry_").optional(),
  rootEntryIds: z.array(z.string().startsWith("entry_")),
  nodes: z.array(sessionTreeNodeSchema),
});
export type SessionTree = z.infer<typeof sessionTreeSchema>;

export const navigateSessionRequestSchema = z.object({
  activeEntryId: z.string().startsWith("entry_").nullable(),
  summarize: z.boolean().optional(),
  summaryInstructions: z.string().optional(),
});
export type NavigateSessionRequest = z.infer<
  typeof navigateSessionRequestSchema
>;

export const compactSessionRequestSchema = z.object({
  instructions: z.string().optional(),
  keepRecentTokens: z.number().int().positive().optional(),
});
export type CompactSessionRequest = z.infer<typeof compactSessionRequestSchema>;

export const modelInfoSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  label: z.string(),
  faux: z.boolean().optional(),
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const agentRequestAuthSchema = z.object({
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type AgentRequestAuth = z.infer<typeof agentRequestAuthSchema>;

export const agentWorkerPromptMessageSchema = z.object({
  type: z.literal("prompt"),
  id: z.string().startsWith("run_"),
  systemPrompt: z.string().optional(),
  messages: z.array(z.unknown()),
  model: modelSelectionSchema.optional(),
  auth: agentRequestAuthSchema.optional(),
});

export const agentWorkerAbortMessageSchema = z.object({
  type: z.literal("abort"),
  id: z.string().startsWith("run_"),
});

export const agentWorkerClientMessageSchema = z.discriminatedUnion("type", [
  agentWorkerPromptMessageSchema,
  agentWorkerAbortMessageSchema,
]);
export type AgentWorkerClientMessage = z.infer<
  typeof agentWorkerClientMessageSchema
>;
export type AgentWorkerPromptMessage = z.infer<
  typeof agentWorkerPromptMessageSchema
>;

export const agentWorkerServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("started"), id: z.string().startsWith("run_") }),
  z.object({
    type: z.literal("text_delta"),
    id: z.string().startsWith("run_"),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("done"),
    id: z.string().startsWith("run_"),
    text: z.string(),
    message: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("error"),
    id: z.string().startsWith("run_").optional(),
    message: z.string(),
    aborted: z.boolean().optional(),
    fatal: z.boolean().optional(),
  }),
]);
export type AgentWorkerServerMessage = z.infer<
  typeof agentWorkerServerMessageSchema
>;

export type IdPrefix =
  | "daemon"
  | "evt"
  | "proj"
  | "ses"
  | "agent"
  | "run"
  | "proc"
  | "entry"
  | "tool"
  | "approval"
  | "worker"
  | "authflow";

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number, length: number): string {
  let value = time;
  let output = "";
  for (let i = length - 1; i >= 0; i -= 1) {
    output = crockford[value % 32] + output;
    value = Math.floor(value / 32);
  }
  return output;
}

function encodeRandom(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let output = "";
  for (const byte of bytes) {
    output += crockford[byte % 32];
  }
  return output;
}

export function createId(prefix: IdPrefix): `${IdPrefix}_${string}` {
  return `${prefix}_${encodeTime(Date.now(), 10)}${encodeRandom(16)}`;
}

export function parseCookieHeader(
  header: string | null | undefined,
): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
}
